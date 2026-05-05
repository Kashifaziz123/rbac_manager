from odoo import models, fields, api, exceptions, http
import json
from collections import defaultdict


class ResUsers(models.Model):
    _inherit = 'res.users'

    # Role assignment field (only for regular users, not roles)
    role_user_ids = fields.Many2many(
        'res.users',
        'user_role_assignment_rel',
        'user_id',
        'role_id',
        string='Assigned Roles',
        domain=[('is_user_role', '=', True), ('active', '=', False)],
        help='Roles (user templates) assigned to this user'
    )

    # Inverse relation - which users have this role
    assigned_user_ids = fields.Many2many(
        'res.users',
        'user_role_assignment_rel',
        'user_id',
        'role_id',
        string='Users with this Role',
        domain=[('is_user_role', '=', False)],
        help='Users who have been assigned this role'
    )

    # Tracking fields - only for regular users
    group_sources = fields.Text(
        string='Group Sources',
        default='{}',
        help='JSON tracking which roles/direct assignments gave which groups'
    )

    # Direct group management (for non-role users)
    direct_group_additions = fields.Many2many(
        'res.groups',
        'user_direct_group_add_rel',
        'user_id',
        'group_id',
        string='Directly Added Groups',
        help='Groups added directly, not through roles'
    )

    direct_group_exclusions = fields.Many2many(
        'res.groups',
        'user_direct_group_exclude_rel',
        'user_id',
        'group_id',
        string='Directly Excluded Groups',
        help='Groups explicitly excluded (overrides roles)'
    )

    @api.constrains('is_user_role', 'role_user_ids')
    def _check_role_not_self_assigned(self):
        """Ensure roles don't have roles assigned to them"""
        self = self.with_context(active_test=False)
        for user in self:
            if user.is_user_role and user.role_user_ids:
                raise exceptions.ValidationError(
                    "Role templates cannot have roles assigned to them")

    @api.model_create_multi
    def create(self, vals_list):
        """Initialize group tracking on user creation"""
        users = super().create(vals_list)
        for user, vals in zip(users, vals_list):
            if not vals.get('is_user_role', False):
                user._initialize_group_tracking()
        return users

    def write(self, vals):
        """Handle updates to users and roles"""
        # Track which roles are being modified if groups are changing
        self = self.with_context(active_test=False)
        _AUDIT_FIELDS = {'role_user_ids', 'direct_group_additions', 'direct_group_exclusions', 'group_ids'}
        if not self._context.get('rbac_audit') and any(field in vals for field in _AUDIT_FIELDS):
            if not self:
                return super(ResUsers, self).write(vals)
            if len(self) > 1:
                for record in self:
                    record.write(vals)
                return True
            rbac_audit = self.env['rbac.audit'].create_log(
                self,
                self._get_rbac_auto_audit_method(vals),
            )
            return self.with_context(rbac_audit=rbac_audit.id).write(vals)

        model = self.env['ir.model'].sudo().search([('model', '=', 'res.users')])
        field_model = self.env["ir.model.fields"].sudo()
        # Only track many2many fields (roles, groups) — skip scalar fields like group_sources
        audit_values = {}
        if self._context.get('rbac_audit', False):
            for val in vals:
                if val not in _AUDIT_FIELDS:
                    continue
                field = field_model.search([("model_id", "in", model.ids), ("name", "=", val)], limit=1)
                if field and 'many' in field.ttype:
                    audit_values[field.id] = [{'id': x.id, 'name': x.name} for x in self[val]]

        roles_groups_changing = self.env['res.users']
        if 'group_ids' in vals:
            roles_groups_changing = self.filtered('is_user_role')

        result = super().write(vals)

        if self._context.get('rbac_audit', False):
            for val in vals:
                if val not in _AUDIT_FIELDS:
                    continue
                field = field_model.search([("model_id", "in", model.ids), ("name", "=", val)], limit=1)
                if not field or 'many' not in field.ttype:
                    continue
                new_value = [{'id': x.id, 'name': x.name} for x in self[val]]
                if audit_values.get(field.id) != new_value:
                    self.env['rbac.audit.line'].sudo().create({
                        'rbac_audit_id': self._context['rbac_audit'],
                        'field_id': field.id,
                        'old_value': str(audit_values.get(field.id, [])),
                        'new_value': str(new_value),
                    })

        # If role groups changed, update all users with those roles
        if roles_groups_changing:
            affected_users = self.env['res.users']
            for role in roles_groups_changing:
                affected_users |= role.assigned_user_ids
            affected_users._recompute_all_groups()

        # Handle role assignment changes for regular users
        if 'role_user_ids' in vals:
            regular_users = self.filtered(lambda u: not u.is_user_role)
            regular_users._recompute_all_groups()

        # Handle conversion between role and user
        if 'is_user_role' in vals:
            for user in self:
                if vals['is_user_role']:
                    # Converting to role - clear tracking fields
                    user.group_sources = '{}'
                    user.direct_group_additions = [(5, 0)]
                    user.direct_group_exclusions = [(5, 0)]
                else:
                    # Converting to regular user - initialize tracking
                    user._initialize_group_tracking()

        return result

    def _get_rbac_auto_audit_method(self, vals):
        self.ensure_one()
        if 'role_user_ids' in vals:
            return 'Update Roles -> %s' % self.name
        if 'group_ids' in vals:
            if self.is_user_role:
                return 'Update Role Permissions -> %s' % self.name
            return 'Update Permissions -> %s' % self.name
        if 'direct_group_additions' in vals:
            return 'Update Extra Permissions -> %s' % self.name
        if 'direct_group_exclusions' in vals:
            return 'Update Excluded Permissions -> %s' % self.name
        return 'Update Access -> %s' % self.name

    def _initialize_group_tracking(self):
        """Initialize group sources with existing groups marked as 'initial'"""
        for user in self.filtered(lambda u: not u.is_user_role):
            sources = {}
            rbac_audit = self.env['rbac.audit'].create_log(user, 'Initialize')
            user = user.with_context(rbac_audit=rbac_audit.id)
            # Mark all current groups as 'initial' (they were there before module install)
            for group in user.group_ids:
                sources[str(group.id)] = ['initial']
            user.group_sources = json.dumps(sources)

    def _get_group_sources(self):
        """Parse and return group sources as dict"""
        if self.is_user_role:
            return {}
        try:
            return json.loads(self.group_sources or '{}')
        except Exception:
            return {}

    def _set_group_sources(self, sources):
        """Save group sources as JSON"""
        if not self.is_user_role:
            self.group_sources = json.dumps(sources)

    @api.onchange('role_user_ids')
    def _onchange_role_user_ids(self):
        """Recalculate groups when roles change"""
        if not self.is_user_role:
            self._recompute_all_groups()

    def _recompute_all_groups(self):
        """Complete recalculation of user groups based on roles and direct assignments"""
        for user in self.with_context(active_test=False).filtered(lambda u: not u.is_user_role):
            # Start with existing sources to preserve history
            existing_sources = user._get_group_sources()
            new_sources = defaultdict(list)
            final_groups = self.env['res.groups']
            implied_excluded_groups = self.env['res.groups']

            # 1. Collect groups from assigned roles (using their group_ids directly)
            for role in user.role_user_ids:
                for group in role.group_ids:
                    group_id_str = str(group.id)
                    new_sources[group_id_str].append(f'role_{role.id}')
                    final_groups |= group

            # 2. Add directly added groups
            for group in user.direct_group_additions:
                group_id_str = str(group.id)
                if 'direct_add' not in new_sources[group_id_str]:
                    new_sources[group_id_str].append('direct_add')
                final_groups |= group

            # 3. Handle exclusions (override everything)
            for group in user.direct_group_exclusions:
                group_id_str = str(group.id)
                new_sources[group_id_str] = ['excluded']
                implied_groups = self.env['rbac.model']._compute_inverse_implied_ids(
                    group.implied_by_ids)
                if len(implied_groups):
                    implied_groups = final_groups.browse([g.id for g in implied_groups])
                    implied_excluded_groups |= implied_groups
                    implied_excluded_groups |= implied_groups.implied_ids
                final_groups -= group

            # 4. Preserve 'initial' sources that are still valid
            for group_id_str, source_list in existing_sources.items():
                if 'initial' in source_list:
                    try:
                        group = self.env['res.groups'].browse(int(group_id_str))
                        if group.exists() and group in user.group_ids:
                            if group_id_str not in new_sources:
                                new_sources[group_id_str] = []
                            if 'initial' not in new_sources[group_id_str]:
                                new_sources[group_id_str].append('initial')
                                if 'excluded' not in new_sources[group_id_str] and int(
                                        group_id_str) not in implied_excluded_groups.ids:
                                    final_groups |= group
                    except Exception:
                        pass

            # 5. Remove implied_excluded_groups
            final_groups -= implied_excluded_groups

            # 6. Update user groups and tracking
            user._set_group_sources(dict(new_sources))
            user.group_ids = [(6, 0, final_groups.ids)]

    def grant_all_permissions(self):
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Grant all')
        self = self.with_context(rbac_audit=rbac_audit.id)

        self = self.with_context(active_test=False)
        implied_excluded_groups = self.env['res.groups']

        for x in ['base.group_user', 'base.group_portal', 'base.group_public']:
            group = self.env.ref(x)
            if group.id not in self.group_ids.ids:
                implied_groups = self.env['rbac.model']._compute_inverse_implied_ids(
                    group.implied_by_ids)
                implied_excluded_groups |= group
                if len(implied_groups):
                    implied_groups = implied_excluded_groups.browse([g.id for g in implied_groups])
                    implied_excluded_groups |= implied_groups
                    implied_excluded_groups |= implied_groups.implied_ids

        direct_group_additions = self.env['res.groups'].search([]) - implied_excluded_groups

        self.write({
            'direct_group_additions': [(4, g.id) for g in direct_group_additions],
        })
        self._recompute_all_groups()

    def revoke_all_permissions(self):
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Revoke all')
        self = self.with_context(rbac_audit=rbac_audit.id)

        self = self.with_context(active_test=False)
        user_type = [0]
        for x in ['base.group_user', 'base.group_portal', 'base.group_public']:
            if self.env.ref(x).id in self.group_ids.ids:
                user_type = self.env.ref(x).ids

        self.write({
            'role_user_ids': [(5, 0)],
            'direct_group_additions': [(6, 0, user_type)],
            'direct_group_exclusions': [(5, 0)],
            'group_sources': json.dumps({}),
        })

    def assign_role(self, role_id):
        role = self.browse(role_id)
        """Assign a role to the user with proper tracking"""
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Add Role -> %s' % role.name)
        self = self.with_context(rbac_audit=rbac_audit.id)

        self = self.with_context(active_test=False)
        if self.is_user_role:
            raise exceptions.ValidationError("Cannot assign roles to a role template")
        if not role.is_user_role:
            raise exceptions.ValidationError("Can only assign user records marked as roles")

        sources = self._get_group_sources()

        # Add role
        self.role_user_ids = [(4, role.id)]

        # Track groups from this role
        for group in role.group_ids:
            group_id_str = str(group.id)
            if group_id_str not in sources:
                sources[group_id_str] = []

            role_source = f'role_{role.id}'
            if role_source not in sources[group_id_str]:
                sources[group_id_str].append(role_source)

        self._set_group_sources(sources)
        self._apply_groups_from_sources(sources)
        return True

    def remove_role(self, role_id):
        role = self.browse(role_id)
        """Remove a role and only remove groups not needed by other sources"""
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Remove Role -> %s' % role.name)
        self = self.with_context(rbac_audit=rbac_audit.id)

        self = self.with_context(active_test=False)
        if self.is_user_role:
            raise exceptions.ValidationError("Cannot remove roles from a role template")

        sources = self._get_group_sources()

        # Remove role
        self.role_user_ids = [(3, role.id)]

        # Remove this role as source for groups
        role_source = f'role_{role.id}'

        for group_id_str in list(sources.keys()):
            if role_source in sources[group_id_str]:
                sources[group_id_str].remove(role_source)
                if not sources[group_id_str]:
                    del sources[group_id_str]

        self._set_group_sources(sources)
        self._apply_groups_from_sources(sources)
        return True

    def add_direct_group_additions(self, group_id):
        """Add a group directly (not through role)"""
        group = self.env['res.groups'].browse(group_id)
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Add Extra -> %s' % group.name)
        self = self.with_context(rbac_audit=rbac_audit.id)

        if self.is_user_role:
            # For roles, just add to their groups normally
            self.group_ids = [(4, group.id)]
            return True

        # For regular users, track the source
        sources = self._get_group_sources()

        # Remove from exclusions if present
        self.direct_group_exclusions = [(3, group.id)]

        # Add to direct additions
        self.direct_group_additions = [(4, group.id)]

        # Update sources
        group_id_str = str(group.id)
        if group_id_str not in sources:
            sources[group_id_str] = []
        if 'direct_add' not in sources[group_id_str]:
            sources[group_id_str].append('direct_add')

        # Remove 'excluded' if present
        if 'excluded' in sources[group_id_str]:
            sources[group_id_str].remove('excluded')

        self._set_group_sources(sources)
        self._apply_groups_from_sources(sources)
        return True

    def remove_direct_group_additions(self, group_id):
        """Remove a direct group addition (doesn't exclude, just removes the override)"""
        group = self.env['res.groups'].browse(group_id)
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Remove Extra -> %s' % group.name)
        self = self.with_context(rbac_audit=rbac_audit.id)

        if self.is_user_role:
            # For roles, just remove from their groups
            self.group_ids = [(3, group.id)]
            return True

        # For regular users, remove the direct addition tracking
        sources = self._get_group_sources()

        # Remove from direct additions
        self.direct_group_additions = [(3, group.id)]

        # Update sources - remove 'direct_add'
        group_id_str = str(group.id)
        if group_id_str in sources and 'direct_add' in sources[group_id_str]:
            sources[group_id_str].remove('direct_add')

            if not sources[group_id_str]:
                del sources[group_id_str]

        self._set_group_sources(sources)
        self._apply_groups_from_sources(sources)
        return True

    def add_direct_group_exclusions(self, group_id):
        """Exclude a group (overrides roles)"""
        group = self.env['res.groups'].browse(group_id)
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Add Exclude -> %s' % group.name)
        self = self.with_context(rbac_audit=rbac_audit.id)

        if self.is_user_role:
            # For roles, just remove from their groups
            self.group_ids = [(3, group.id)]
            return True

        # For regular users, track the exclusion
        sources = self._get_group_sources()

        # Remove from direct additions if present
        self.direct_group_additions = [(3, group.id)]

        # Add to exclusions
        self.direct_group_exclusions = [(4, group.id)]

        # Update sources - exclusion overrides everything
        group_id_str = str(group.id)
        sources[group_id_str] = ['excluded']

        self._set_group_sources(sources)
        self._apply_groups_from_sources(sources)
        self._recompute_all_groups()
        return True

    def remove_direct_group_exclusions(self, group_id):
        """Remove a group exclusion (allows role-based groups to apply again)"""
        group = self.env['res.groups'].browse(group_id)
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Remove Exclude -> %s' % group.name)
        self = self.with_context(rbac_audit=rbac_audit.id)

        if self.is_user_role:
            # For roles, add back to their groups
            self.group_ids = [(4, group.id)]
            return True

        # For regular users, remove the exclusion
        sources = self._get_group_sources()

        # Remove from exclusions
        self.direct_group_exclusions = [(3, group.id)]

        # Update sources - remove 'excluded'
        group_id_str = str(group.id)
        if group_id_str in sources and 'excluded' in sources[group_id_str]:
            sources[group_id_str].remove('excluded')

            if not sources[group_id_str]:
                del sources[group_id_str]

        self._set_group_sources(sources)
        self._apply_groups_from_sources(sources)
        self._recompute_all_groups()
        return True

    def remove_initial_group(self, group_id):
        """Remove a group initial (allows role-based groups to apply again)"""
        group = self.env['res.groups'].browse(group_id)
        self.ensure_one()
        rbac_audit = self.env['rbac.audit'].create_log(self, 'Remove Initial -> %s' % group.name)
        self = self.with_context(rbac_audit=rbac_audit.id)

        # For regular users, remove the initial source
        sources = self._get_group_sources()

        group_id_str = str(group.id)
        if group_id_str in sources and 'initial' in sources[group_id_str]:
            sources[group_id_str].remove('initial')

            if not sources[group_id_str]:
                del sources[group_id_str]

        self._set_group_sources(sources)
        self._apply_groups_from_sources(sources)
        return True

    def _apply_groups_from_sources(self, sources):
        """Apply groups based on sources tracking"""
        if self.is_user_role:
            return

        final_groups = self.env['res.groups']
        excluded_groups = self.env['res.groups']

        # First pass: collect explicitly excluded groups and their implications
        for group_id_str, source_list in sources.items():
            if 'excluded' in source_list:
                try:
                    group = self.env['res.groups'].browse(int(group_id_str))
                    if group.exists():
                        excluded_groups |= group

                        # Get all groups that imply this excluded group
                        inverse_implied_groups = self.env[
                            'rbac.model']._compute_inverse_implied_ids(group.implied_by_ids)
                        if inverse_implied_groups:
                            implied_groups = self.env['res.groups'].browse(
                                [g.id for g in inverse_implied_groups])
                            excluded_groups |= implied_groups
                            excluded_groups |= implied_groups.mapped('implied_ids')
                except Exception:
                    pass

        # Second pass: add non-excluded groups
        for group_id_str, source_list in sources.items():
            if 'excluded' in source_list:
                continue

            if source_list:
                try:
                    group = self.env['res.groups'].browse(int(group_id_str))
                    if group.exists() and group not in excluded_groups:
                        final_groups |= group
                except Exception:
                    pass

        # Remove any excluded groups that might have been added
        final_groups -= excluded_groups

        # Avoid unnecessary write if groups haven't changed
        if set(final_groups.ids) != set(self.group_ids.ids):
            self.group_ids = [(6, 0, final_groups.ids)]

    @api.model
    def _init_existing_users_on_module_install(self):
        """Called on module install to initialize tracking for existing users"""
        regular_users = self.search([('is_user_role', '=', False)])
        for user in regular_users:
            if not user.group_sources or user.group_sources == '{}':
                user._initialize_group_tracking()

    def get_group_summary(self):
        """Get a summary of where each group comes from (for debugging/UI)"""
        self.ensure_one()

        if self.is_user_role:
            return {
                'type': 'role',
                'groups': self.group_ids.mapped('name'),
                'assigned_to_users': self.assigned_user_ids.mapped('name')
            }

        sources = self._get_group_sources()
        summary = {
            'type': 'user',
            'assigned_roles': self.role_user_ids.mapped('name'),
            'groups_breakdown': {}
        }

        for group_id_str, source_list in sources.items():
            try:
                group = self.env['res.groups'].browse(int(group_id_str))
                if group.exists():
                    readable_sources = []
                    for source in source_list:
                        if source.startswith('role_'):
                            role_id = int(source.replace('role_', ''))
                            role = self.browse(role_id)
                            if role.exists():
                                readable_sources.append(f"Role: {role.name}")
                        elif source == 'direct_add':
                            readable_sources.append("Directly Added")
                        elif source == 'excluded':
                            readable_sources.append("EXCLUDED (overrides all)")
                        elif source == 'initial':
                            readable_sources.append("Initial (pre-module)")
                        else:
                            readable_sources.append(source)

                    summary['groups_breakdown'][group.name] = {
                        'sources': readable_sources,
                        'active': 'excluded' not in source_list
                    }
            except Exception:
                pass

        return summary

    def debug_role_system(self):
        """Debug method to see the current state of role system"""
        self.ensure_one()
        print(f"\n{'=' * 60}")
        print(f"User/Role: {self.name}")
        print(f"Type: {'ROLE' if self.is_user_role else 'USER'}")
        print(f"{'=' * 60}")

        if self.is_user_role:
            print(f"Groups this role provides: {', '.join(self.group_ids.mapped('name'))}")
            print(f"Users with this role: {', '.join(self.assigned_user_ids.mapped('name'))}")
        else:
            print(f"Assigned Roles: {', '.join(self.role_user_ids.mapped('name'))}")
            print(f"Direct Additions: {', '.join(self.direct_group_additions.mapped('name'))}")
            print(f"Direct Exclusions: {', '.join(self.direct_group_exclusions.mapped('name'))}")
            print(f"\nGroup Sources:")
            sources = self._get_group_sources()
            for group_id_str, source_list in sources.items():
                try:
                    group = self.env['res.groups'].browse(int(group_id_str))
                    if group.exists():
                        print(f"  - {group.name}: {source_list}")
                except Exception:
                    pass
            print(f"\nFinal Groups: {', '.join(self.group_ids.mapped('name'))}")
        print(f"{'=' * 60}\n")

    def test_direct_add_role_overlap(self):
        """
        Test that directly added groups persist even when roles that provide
        the same group are added and removed.
        """
        if self.is_user_role:
            raise exceptions.ValidationError("This test is for regular users only")

        test_group = self.env['res.groups'].search([('name', '=', 'Test Group')], limit=1)
        if not test_group:
            test_group = self.env['res.groups'].create({'name': 'Test Group'})

        test_role = self.env['res.users'].search([
            ('name', '=', 'Test Role'),
            ('is_user_role', '=', True)
        ], limit=1)
        if not test_role:
            test_role = self.env['res.users'].create({
                'name': 'Test Role',
                'login': 'test_role',
                'is_user_role': True,
                'group_ids': [(4, test_group.id)]
            })

        print("\n=== TESTING DIRECT ADD + ROLE OVERLAP ===")

        print("1. Adding group directly...")
        self.add_direct_group_additions(test_group.id)
        sources = self._get_group_sources()
        print(f"   Sources for test group: {sources.get(str(test_group.id), [])}")
        assert 'direct_add' in sources.get(str(test_group.id),
                                           []), "Group should have direct_add source"
        assert test_group in self.group_ids, "Group should be in user's groups"

        print("2. Assigning role that also provides this group...")
        self.assign_role(test_role.id)
        sources = self._get_group_sources()
        print(f"   Sources for test group: {sources.get(str(test_group.id), [])}")
        assert 'direct_add' in sources.get(str(test_group.id), []), "Should still have direct_add"
        assert f'role_{test_role.id}' in sources.get(str(test_group.id),
                                                     []), "Should also have role source"
        assert test_group in self.group_ids, "Group should still be in user's groups"

        print("3. Removing the role...")
        self.remove_role(test_role.id)
        sources = self._get_group_sources()
        print(f"   Sources for test group: {sources.get(str(test_group.id), [])}")
        assert 'direct_add' in sources.get(str(test_group.id), []), "Should still have direct_add"
        assert f'role_{test_role.id}' not in sources.get(str(test_group.id),
                                                         []), "Role source should be gone"
        assert test_group in self.group_ids, "Group should STILL be in user's groups (from direct_add)"

        print("4. Removing direct addition...")
        self.direct_group_additions = [(3, test_group.id)]
        self._recompute_all_groups()
        sources = self._get_group_sources()
        print(f"   Sources for test group: {sources.get(str(test_group.id), [])}")
        assert str(test_group.id) not in sources, "Group should have no sources now"
        assert test_group not in self.group_ids, "Group should be removed from user's groups"

        print("TEST PASSED: Direct additions persist correctly through role changes\n")
