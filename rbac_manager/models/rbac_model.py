# -*- coding: utf-8 -*-
from odoo.tools import DEFAULT_SERVER_DATE_FORMAT, DEFAULT_SERVER_TIME_FORMAT
from odoo import api, fields, models, exceptions, _
from odoo.tools.safe_eval import safe_eval
from dateutil.relativedelta import relativedelta
from datetime import datetime
from lxml import etree
import json
import time

max_depth = 10


class RbacModel(models.Model):
    _name = 'rbac.model'
    _description = 'RBAC Model'

    def _compute_inverse_implied_ids(self, implied_by_ids, max_depth=10):
        """Recursively collect all groups that imply the given groups (via implied_by_ids)."""
        collected = []

        def collect_recursive(groups, depth=0):
            nonlocal collected
            if depth >= max_depth or not groups:
                return

            for group in groups:
                collected.append(group)
                collect_recursive(group.implied_by_ids, depth + 1)

        collect_recursive(implied_by_ids)
        return collected

    def _get_time_passed(self, dt, now=None):
        if not dt:
            return "0 minutes"

        if now is None:
            now = datetime.utcnow()

        future = dt > now
        start, end = (now, dt) if future else (dt, now)
        rd = relativedelta(end, start)

        if rd.years >= 1:
            pair = ((" year", rd.years), (" month", rd.months))
        elif rd.months >= 1:
            pair = ((" month", rd.months), (" day", rd.days))
        elif rd.days >= 1:
            pair = (("day", rd.days), (" hour", rd.hours))
        else:
            pair = ((" hour", rd.hours), (" minute", rd.minutes))

        p = lambda n, s: f"{n}{s}{'s' * (n != 1)}"
        a, b = pair
        parts = ([p(a[1], a[0])] if a[1] else []) + ([p(b[1], b[0])] if b[1] else [])

        if not parts:
            return "just now"

        duration = " ".join(parts)
        if future:
            return f"in {duration}"
        return f"{duration} ago"

    def _get_employee(self):
        try:
            employee = self.env['hr.employee'].sudo().search([('user_id', '=', self.id)])
            return {'barcode': employee.barcode}
        except Exception:
            return {}

    def _get_user_type(self, user):
        user_type = ""
        for x in ['base.group_user', 'base.group_portal', 'base.group_public']:
            if self.env.ref(x).id in user.group_ids.ids:
                user_type = self.env.ref(x).name
        return user_type

    @api.model
    def clone_users_list(self, user_id):
        ret_list = []
        try:
            users = self.env['res.users'].search(
                [('is_user_role', '=', False), ('id', '!=', user_id)])
            for user in users:
                ret_list.append({
                    'id': user.id,
                    'name': user.name,
                    'categories': json.dumps(
                        list(filter(None, user.group_ids.mapped('privilege_id.category_id.name')))
                    )
                })
        except Exception:
            pass
        return ret_list

    @api.model
    def export_permissions_csv(self, user_id):
        context = dict(self._context)
        context.update({
            "params": {"action": "super_admin", "actionStack": [{"action": "super_admin"}]}
        })
        data = {
            "import_compat": False,
            "context": context,
            "domain": [["is_user_role", "=", False]],
            "fields": [
                {"name": ".id", "label": "ID", "type": "integer"},
                {"name": "id", "label": "External ID", "type": "integer"},
                {"name": "name", "label": "Name", "type": "char"},
                {"name": "group_ids/.id", "label": "Groups/ID", "type": "integer"},
                {"name": "group_ids/id", "label": "Groups/External ID", "type": "many2many"},
                {"name": "group_ids/name", "label": "Groups/Name", "type": "char"},
                {"name": "group_ids/risk_level", "label": "Groups/Risk Level", "type": "selection"}
            ], "groupby": [], "ids": [user_id], "model": "res.users"
        }
        return data

    @api.model
    def get_role_templates(self, user_id, page=1, page_size=20, search='', risk_levels=None):
        """
        Return one page of role-template permissions, filtered server-side.

        :param user_id:    ID of the role-template user
        :param page:       1-based page number
        :param page_size:  items per page
        :param search:     case-insensitive substring filter on group name
        :param risk_levels: list of risk levels to show, e.g. ['low','high'];
                            empty list = no filter (all non-critical shown)
        :returns: {
            'categories':  { category: { field: data } },  # current page only
            'total':       int,
            'page':        int,
            'total_pages': int,
        }
        """
        try:
            if risk_levels is None:
                risk_levels = []
            search = (search or '').strip().lower()

            all_groups = self.env['res.groups'].get_categories_groups_json(user_id)

            # Build flat ordered list applying all filters in Python
            flat = []
            for category, content in all_groups.items():
                for field_name, data in content.items():
                    if data['groups'] is False:
                        group = data.get('group') or {}
                        if group.get('risk_level') == 'critical':
                            continue
                        if risk_levels and group.get('risk_level') not in risk_levels:
                            continue
                        if search and search not in (group.get('name') or '').lower():
                            continue
                        flat.append((category, field_name, data))
                    else:
                        filtered_groups = [
                            g for g in (data.get('groups') or [])
                            if g.get('risk_level') != 'critical'
                            and (not risk_levels or g.get('risk_level') in risk_levels)
                            and (not search or search in (g.get('name') or '').lower())
                        ]
                        if filtered_groups:
                            flat.append((category, field_name, {**data, 'groups': filtered_groups}))

            total = len(flat)
            total_pages = max(1, (total + page_size - 1) // page_size)
            page = max(1, min(int(page), total_pages))
            start = (page - 1) * page_size
            page_items = flat[start:start + page_size]

            categories = {}
            for cat, field_name, entry in page_items:
                categories.setdefault(cat, {})[field_name] = entry

            return {
                'categories': categories,
                'total': total,
                'page': page,
                'total_pages': total_pages,
            }
        except Exception:
            return {'categories': {}, 'total': 0, 'page': 1, 'total_pages': 1}

    @api.model
    def get_user_permissions_json(self, user_id):
        try:
            self_user = self.env['res.users'].with_context(active_test=False).browse([user_id])
            groups = self_user.sudo().group_ids
            categ_dict = {}
            categories = groups.get_categories_groups_json(user_id)
            for category in categories:
                categ_dict[category] = {
                    'granted': len([c for c in categories[category].keys() if
                                    categories[category][c]['value'] != False]),
                    'total': len(categories[category].keys())
                }

            return {
                'total': {
                    'granted': len(groups),
                    'denied': len(self.env['res.groups'].sudo().search([])) - len(groups),
                    'high_risk_granted': len(
                        groups.filtered(lambda g: g.risk_level == 'high')),
                },
                'updated_on': self._get_time_passed(self_user.write_date),
                'categories': categ_dict,
                'all_categories': categories,
                'employee': self._get_employee(),
                'error': False,
                'rbac_permissions': [{
                    'id': rbac.id,
                    'description': rbac.description,
                    'group': {'id': rbac.group_id.id, 'name': rbac.group_id.name},
                    'type': rbac.type,
                    'state': rbac.state,
                    'created_by': rbac.requested_by.name,
                    'created_on': self._get_time_passed(rbac.create_date),
                } for rbac in
                    self.env['request.rbac.permission'].search([('user_id', '=', user_id)])],
                'assigned_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().group_ids)
                    } for user in self_user.role_user_ids
                ],
                'exclusion': len(self_user.direct_group_exclusions),
                'extra': len(self_user.direct_group_additions),
                'group_sources': self_user.group_sources,
                "roles": {
                    user.id: user.name
                    for user in
                    self_user.search([('active', '=', False), ('is_user_role', '=', True)])},
            }
        except Exception:
            return {
                'total': {'granted': 0, 'denied': 0, 'high_risk_granted': 0},
                'updated_on': '0 seconds',
                'categories': {},
                'all_categories': {},
                'employee': {},
                'error': True,
                'rbac_permissions': [],
                'assigned_roles': [],
                'exclusion': 0,
                'extra': 0,
                'group_sources': json.dumps({}),
                "roles": {},
            }

    @api.model
    def get_manage_permissions_json(self, user_id):
        try:
            self_user = self.env['res.users'].with_context(active_test=False).browse([user_id])
            return {
                'available_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().group_ids)
                    } for user in
                    (self_user.search([('active', '=', False),
                                       ('is_user_role', '=', True)]) - self_user.role_user_ids)
                ],
                'assigned_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().group_ids)
                    } for user in self_user.role_user_ids
                ],
                'employee': self._get_employee(),
                'error': False,
                'permissions': {
                    'deny': [{'id': group.id, 'name': group.name} for group in
                             self_user.group_ids],
                    'grant': [{'id': group.id, 'name': group.name} for group in
                              (self.env['res.groups'].search([]) - self_user.group_ids)]
                },
            }
        except Exception as e:
            return {
                'available_roles': [],
                'assigned_roles': [],
                'employee': {},
                'error': True,
                'permissions': {'deny': [], 'grant': []},
            }

    @api.model
    def get_rbac_super_admin_json(self, user_id):
        try:
            self_user = self.env['res.users'].with_context(active_test=False).browse([user_id])
            groups = self_user.sudo().group_ids
            categories = groups.get_categories_groups_json(user_id)

            return {
                'available_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().group_ids)
                    } for user in
                    (self_user.search([('active', '=', False),
                                       ('is_user_role', '=', True)]) - self_user.role_user_ids)
                ],
                'assigned_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().group_ids)
                    } for user in self_user.role_user_ids
                ],
                'all_categories': categories,
                'employee': self._get_employee(),
                'error': False,
                'group_sources': self_user.group_sources,
                "roles": {
                    user.id: user.name
                    for user in
                    self_user.search([('active', '=', False), ('is_user_role', '=', True)])},
                'inverse_implied_ids': {
                    group.id: [g.name for g in
                               self._compute_inverse_implied_ids(group.implied_by_ids)]
                    for group in self.env['res.groups'].search([])
                },
                'user_type': self._get_user_type(self_user),
            }
        except Exception:
            return {
                'available_roles': [],
                'assigned_roles': [],
                'all_categories': [],
                'employee': {},
                'error': True,
                'group_sources': json.dumps({}),
                'roles': {},
                'inverse_implied_ids': {},
                'user_type': '',
            }

    @api.model
    def get_recent_audit_changes(self, user_id, limit=10, offset=0):
        """Paginated recent audit logs for a specific user (last 30 days)."""
        try:
            import pytz
            from datetime import timedelta

            user_tz = self.env.user.tz or 'UTC'
            tz = pytz.timezone(user_tz)
            now_utc = datetime.utcnow()
            thirty_days_ago = now_utc - timedelta(days=30)

            domain = [
                ('user_uid', '=', user_id),
                ('create_date', '>=', thirty_days_ago),
            ]

            total_count = self.env['rbac.audit'].sudo().search_count(domain)
            logs = self.env['rbac.audit'].sudo().search(
                domain, limit=limit, offset=offset, order='create_date desc'
            )

            records = []
            for log in logs:
                if not log.create_date:
                    continue
                utc_dt = log.create_date.replace(tzinfo=pytz.utc)
                local_dt = utc_dt.astimezone(tz)
                local_dt_str = local_dt.strftime("%b %d, %Y at %I:%M %p")

                method = log.method or 'Unknown'
                action_type = method.split('->')[0].strip()
                if any(k in action_type.lower() for k in ['add', 'assign']):
                    indicator = 'added'
                elif any(k in action_type.lower() for k in ['remove', 'revoke']):
                    indicator = 'removed'
                elif any(k in action_type.lower() for k in ['update', 'modify']):
                    indicator = 'modified'
                else:
                    indicator = 'neutral'

                records.append({
                    'action': action_type,
                    'details': method,
                    'timestamp': local_dt_str,
                    'ago': self._get_time_passed(log.create_date, now_utc),
                    'performed_by': log.create_uid.name or '',
                    'indicator': indicator,
                })

            return {
                'error': False,
                'records': records,
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
            }
        except Exception as e:
            return {'error': True, 'message': str(e), 'records': []}

    @api.model
    def get_rbac_user_recent_activity(self, user_id, limit=15, offset=0):
        """Return recent permission, role, and rule activity related to a user."""
        try:
            import ast
            import pytz

            user = self.env['res.users'].with_context(active_test=False).sudo().browse(user_id).exists()
            if not user:
                return {'error': False, 'records': [], 'limit': limit, 'offset': offset, 'total_count': 0}

            limit = min(max(int(limit or 15), 1), 30)
            offset = max(int(offset or 0), 0)
            role_ids = user.role_user_ids.ids
            domain = ['|', ('user_uid', '=', user.id), ('method', 'ilike', 'Access Rule')]
            if role_ids:
                domain = ['|'] + domain + [('user_uid', 'in', role_ids)]
            logs = self.env['rbac.audit'].sudo().search(domain, order='create_date desc, id desc', limit=500)
            related_logs = logs.filtered(lambda log: self._rbac_audit_log_related_to_user(log, user))
            total_count = len(related_logs)
            page = related_logs[offset:offset + limit]

            user_tz = self.env.user.tz or 'UTC'
            tz = pytz.timezone(user_tz)
            now_utc = datetime.utcnow()

            def parse_value(value):
                if not value:
                    return None
                if not isinstance(value, str):
                    return value
                try:
                    return json.loads(value)
                except Exception:
                    try:
                        return ast.literal_eval(value)
                    except Exception:
                        return value

            records = []
            for log in page:
                local_dt_str = ''
                ago = ''
                if log.create_date:
                    utc_dt = log.create_date.replace(tzinfo=pytz.utc)
                    local_dt_str = utc_dt.astimezone(tz).strftime("%b %d, %Y at %I:%M %p")
                    ago = self._get_time_passed(log.create_date, now_utc)

                method = log.method or _('Unknown activity')
                action = method.split('->')[0].strip() or method
                lower_action = action.lower()
                if 'access rule' in lower_action:
                    category = 'Rule'
                    icon = 'fa-shield'
                elif 'role' in lower_action:
                    category = 'Role'
                    icon = 'fa-star-o'
                else:
                    category = 'Permission'
                    icon = 'fa-key'
                if any(term in lower_action for term in ('add', 'assign', 'grant', 'create')):
                    indicator = 'added'
                elif any(term in lower_action for term in ('remove', 'revoke', 'delete')):
                    indicator = 'removed'
                elif any(term in lower_action for term in ('update', 'modify', 'status', 'change')):
                    indicator = 'modified'
                else:
                    indicator = 'neutral'
                message = self._rbac_activity_message(method, category, log.user_uid.name or user.name or '')

                changes = []
                for line in log.line_ids:
                    old_value = parse_value(line.old_value)
                    new_value = parse_value(line.new_value)
                    if old_value == new_value:
                        continue
                    changes.extend(self._rbac_activity_change_messages(
                        line.field_name,
                        line.field_description,
                        old_value,
                        new_value,
                    ))
                    if len(changes) >= 6:
                        break

                records.append({
                    'id': log.id,
                    'action': message['title'],
                    'details': message['summary'],
                    'subject': message['subject'],
                    'category': category,
                    'icon': icon,
                    'indicator': indicator,
                    'timestamp': local_dt_str,
                    'ago': ago,
                    'performed_by': log.create_uid.name or '',
                    'target': log.user_uid.name or '',
                    'changes': changes[:6],
                })

            return {
                'error': False,
                'records': records,
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
            }
        except Exception as e:
            return {'error': True, 'message': str(e), 'records': []}

    def _rbac_activity_message(self, method, category, target_name):
        action, subject = [part.strip() for part in (method or '').split('->', 1)] if '->' in (method or '') else ((method or '').strip(), '')
        subject = subject or target_name or _('this user')
        action_key = action.lower()

        messages = [
            ('add role', 'Role assigned', '%s was assigned to this user.'),
            ('remove role', 'Role removed', '%s was removed from this user.'),
            ('create role', 'Role created', '%s was created.'),
            ('delete role', 'Role deleted', '%s was deleted.'),
            ('update role permissions', 'Role permissions updated', 'Permissions inside %s were changed. This user is affected because they have that role.'),
            ('add extra', 'Direct permission granted', '%s was granted directly to this user.'),
            ('remove extra', 'Direct permission removed', '%s was removed from this user’s direct permissions.'),
            ('add exclude', 'Permission blocked', '%s was blocked for this user.'),
            ('remove exclude', 'Permission unblocked', '%s is no longer blocked for this user.'),
            ('grant all', 'All permissions granted', 'All available permissions were granted directly to this user.'),
            ('revoke all', 'Permissions revoked', 'Roles, direct permissions, and exclusions were revoked for this user.'),
            ('remove initial', 'Base permission removed', '%s was removed from the user’s initial permissions.'),
            ('access rule created', 'Access rule created', 'The rule %s was created and currently affects this user.'),
            ('access rule updated', 'Access rule updated', 'The rule %s was updated and currently affects this user.'),
            ('access rule status changed', 'Access rule status changed', 'The rule %s was enabled or paused.'),
            ('access rule deleted', 'Access rule deleted', 'The rule %s was deleted.'),
            ('initialize', 'Permissions initialized', 'Initial RBAC permissions were prepared for this user.'),
        ]
        for key, title, template in messages:
            if action_key.startswith(key):
                return {
                    'title': title,
                    'summary': self._rbac_format_activity_sentence(template, subject),
                    'subject': subject,
                }
        if category == 'Rule':
            return {
                'title': action or _('Access rule changed'),
                'summary': _('Access Studio rule settings changed for this user.'),
                'subject': subject,
            }
        return {
            'title': action or _('Permission activity'),
            'summary': self._rbac_format_activity_sentence(_('RBAC access was changed for %s.'), subject),
            'subject': subject,
        }

    def _rbac_format_activity_sentence(self, template, subject):
        text = str(template or '')
        subject = str(subject or '')
        if '%s' in text:
            try:
                return text % subject
            except Exception:
                return text.replace('%s', subject)
        return '%s %s' % (text.rstrip('.'), subject) if subject else text

    def _rbac_activity_field_label(self, field_name, field_description):
        labels = {
            'group_ids': 'Permissions',
            'role_user_ids': 'Roles',
            'direct_group_additions': 'Direct grants',
            'direct_group_exclusions': 'Blocked permissions',
            'audience_json': 'Audience',
            'config_json': 'Restrictions',
            'impact_json': 'Impact summary',
            'active': 'Status',
            'risk': 'Risk',
            'priority': 'Priority',
            'sequence': 'Priority order',
            'name': 'Name',
            'description': 'Description',
        }
        return labels.get(field_name) or field_description or field_name or _('Change')

    def _rbac_activity_change_messages(self, field_name, field_description, old_value, new_value):
        if field_name == 'config_json':
            return [{'message': message} for message in self._rbac_config_impact_messages(new_value)]
        if field_name == 'audience_json':
            return [{'message': 'Rule audience changed to %s.' % self._rbac_activity_value_label(new_value, field_name)}]
        if field_name == 'active':
            return [{'message': 'Rule was %s.' % ('activated' if new_value else 'paused')}]
        if field_name in ('risk', 'priority'):
            return [{'message': '%s changed to %s.' % (self._rbac_activity_field_label(field_name, field_description), self._rbac_activity_value_label(new_value, field_name))}]
        if field_name in ('group_ids', 'role_user_ids', 'direct_group_additions', 'direct_group_exclusions'):
            old_names = set(self._rbac_activity_names(old_value))
            new_names = set(self._rbac_activity_names(new_value))
            added = sorted(new_names - old_names)
            removed = sorted(old_names - new_names)
            label = self._rbac_activity_field_label(field_name, field_description).lower()
            messages = []
            messages += ['%s added: %s.' % (label.capitalize(), name) for name in added[:3]]
            messages += ['%s removed: %s.' % (label.capitalize(), name) for name in removed[:3]]
            return [{'message': message} for message in messages]
        return []

    def _rbac_activity_names(self, value):
        if not isinstance(value, list):
            return []
        names = []
        for item in value:
            if isinstance(item, dict):
                names.append(item.get('name') or item.get('label') or item.get('full_name') or str(item.get('id') or ''))
            elif item:
                names.append(str(item))
        return [name for name in names if name]

    def _rbac_config_impact_messages(self, config):
        if not isinstance(config, dict):
            return []
        messages = []
        for menu in config.get('hide_menus') or []:
            name = menu.get('name') if isinstance(menu, dict) else ''
            if name:
                messages.append('Menu hidden: %s.' % name)

        model_flag_labels = {
            'readonly': 'made read-only',
            'restrict_create': 'create hidden',
            'restrict_edit': 'edit hidden',
            'restrict_delete': 'delete hidden',
            'restrict_archive': 'archive hidden',
            'restrict_duplicate': 'duplicate hidden',
            'restrict_import': 'import hidden',
            'restrict_export': 'export hidden',
        }
        for model in config.get('models') or []:
            if not isinstance(model, dict):
                continue
            flags = [label for key, label in model_flag_labels.items() if model.get(key)]
            if flags:
                messages.append('Model %s: %s.' % (model.get('name') or model.get('model') or 'selected model', ', '.join(flags)))

        field_flag_labels = {
            'invisible': 'hidden',
            'readonly': 'read-only',
            'required': 'required',
            'external_link': 'external link removed',
        }
        for rule in config.get('fields') or []:
            if not isinstance(rule, dict):
                continue
            flags = [label for key, label in field_flag_labels.items() if rule.get(key)]
            fields = ', '.join(self._rbac_activity_names(rule.get('fields') or []))
            if flags and fields:
                messages.append('Field access on %s: %s set to %s.' % (rule.get('model_name') or rule.get('model') or 'model', fields, ', '.join(flags)))

        for rule in config.get('domain_access') or []:
            if isinstance(rule, dict):
                messages.append('Domain access applied on %s.' % (rule.get('name') or rule.get('model') or 'model'))
        for rule in config.get('button_tab_access') or []:
            if isinstance(rule, dict):
                node_names = ', '.join(self._rbac_activity_names(rule.get('nodes') or []))
                if node_names:
                    messages.append('Buttons/tabs hidden on %s: %s.' % (rule.get('model_name') or rule.get('model') or 'model', node_names))
        for rule in config.get('filter_group_access') or []:
            if isinstance(rule, dict):
                node_names = ', '.join(self._rbac_activity_names(rule.get('nodes') or []))
                if node_names:
                    messages.append('Filters/group-by hidden on %s: %s.' % (rule.get('model_name') or rule.get('model') or 'model', node_names))

        global_labels = {
            'force_readonly': 'System forced read-only',
            'hide_import': 'Import hidden',
            'hide_export': 'Export hidden',
            'hide_spreadsheet': 'Spreadsheet hidden',
            'hide_add_property': 'Add property hidden',
            'disable_dev_mode': 'Developer mode disabled',
            'hide_technical_settings': 'Technical settings hidden',
            'hide_chatter': 'Chatter hidden',
            'hide_send_message': 'Send message hidden',
            'hide_log_note': 'Log note hidden',
            'hide_activity': 'Activities hidden',
        }
        messages += ['%s.' % label for key, label in global_labels.items() if config.get(key)]
        return messages[:8] or ['Access Studio restrictions were updated.']

    def _rbac_activity_value_label(self, value, field_name=None):
        if field_name == 'audience_json' and isinstance(value, dict):
            parts = []
            for key, label in (('roles', 'roles'), ('users', 'users'), ('depts', 'departments'), ('companies', 'companies'), ('exclude', 'excluded users')):
                count = len(value.get(key) or [])
                if count:
                    parts.append('%s %s' % (count, label))
            return ', '.join(parts) if parts else 'All users'
        if field_name == 'config_json' and isinstance(value, dict):
            labels = []
            checks = (
                ('hide_menus', 'menus'),
                ('models', 'model access'),
                ('fields', 'field access'),
                ('domain_access', 'domain access'),
                ('button_tab_access', 'buttons/tabs'),
                ('filter_group_access', 'filters/group by'),
            )
            for key, label in checks:
                if value.get(key):
                    labels.append(label)
            for key, label in (
                ('force_readonly', 'force read-only'),
                ('hide_chatter', 'hide chatter'),
                ('hide_import', 'hide import'),
                ('hide_export', 'hide export'),
            ):
                if value.get(key):
                    labels.append(label)
            return ', '.join(labels[:5]) + ('...' if len(labels) > 5 else '') if labels else 'No restrictions'
        if field_name == 'impact_json' and isinstance(value, list):
            labels = [item.get('label') for item in value if isinstance(item, dict) and item.get('label')]
            return ', '.join(labels[:4]) + ('...' if len(labels) > 4 else '') if labels else 'No impact'
        if isinstance(value, dict):
            if value.get('name'):
                return value['name']
            return ', '.join('%s: %s' % (key, self._rbac_activity_value_label(val)) for key, val in value.items())[:180]
        if isinstance(value, list):
            labels = []
            for item in value:
                if isinstance(item, dict):
                    labels.append(item.get('name') or item.get('label') or item.get('model') or str(item.get('id') or item))
                else:
                    labels.append(str(item))
            return ', '.join(labels[:4]) + ('...' if len(labels) > 4 else '')
        if value in (False, None, ''):
            return 'Empty'
        return str(value)[:180]

    def _rbac_audit_log_related_to_user(self, log, user):
        method = log.method or ''
        is_access_rule_log = 'Access Rule' in method
        if log.user_uid.id == user.id and not is_access_rule_log:
            return True
        if log.user_uid and log.user_uid in user.role_user_ids:
            return True
        if not is_access_rule_log:
            return False
        rule_name = method.split('->', 1)[1].strip() if '->' in method else ''
        if rule_name:
            rules = self.env['rbac.access.rule'].with_context(active_test=False).sudo().search([
                ('name', '=', rule_name),
            ])
            if any(self._rbac_rule_audience_matches_user(rule.audience_json or {}, user) for rule in rules):
                return True
        for line in log.line_ids:
            if line.field_name != 'audience_json':
                continue
            for raw_value in (line.old_value, line.new_value):
                audience = self._rbac_parse_audit_json(raw_value)
                if self._rbac_rule_audience_matches_user(audience, user):
                    return True
        return False

    def _rbac_parse_audit_json(self, value):
        if not value:
            return {}
        if isinstance(value, dict):
            return value
        try:
            return json.loads(value)
        except Exception:
            return {}

    def _rbac_rule_audience_matches_user(self, audience, user):
        if not isinstance(audience, dict):
            return False

        def ids_from(items):
            return {item.get('id') for item in items if isinstance(item, dict) and item.get('id')}

        def names_from(items):
            return {item.get('name') for item in items if isinstance(item, dict) and item.get('name')}

        if user.id in ids_from(audience.get('exclude') or []):
            return False
        role_ids = ids_from(audience.get('roles') or [])
        user_ids = ids_from(audience.get('users') or [])
        company_ids = ids_from(audience.get('companies') or [])
        dept_names = names_from(audience.get('depts') or [])
        if not any([role_ids, user_ids, company_ids, dept_names]):
            return True
        if user.id in user_ids:
            return True
        if role_ids & set(user.role_user_ids.ids):
            return True
        if company_ids & set(user.company_ids.ids):
            return True
        department = self._get_user_department_name(user)
        return bool(department and department in dept_names)

    @api.model
    def get_rbac_dashboard(self):
        """Return dynamic data for the RBAC access overview dashboard."""
        users = self.env['res.users'].sudo().search([
            ('is_user_role', '=', False),
            ('active', '=', True),
        ])
        roles = self.env['res.users'].with_context(active_test=False).sudo().search([
            ('is_user_role', '=', True),
            ('active', '=', False),
        ], order='name')
        requests = self.env['request.rbac.permission'].sudo().search([], order='create_date desc, id desc')
        pending_requests = requests.filtered(lambda req: req.state == 'pending')

        extra_count = sum(len(user.direct_group_additions) for user in users)
        excluded_count = sum(len(user.direct_group_exclusions) for user in users)
        total_active_permissions = sum(len(user.group_ids) for user in users)
        role_base_permissions = sum(len(role.group_ids) for role in roles)
        users_with_roles = len(users.filtered(lambda user: bool(user.role_user_ids)))

        top_roles = []
        max_role_users = 1
        for role in roles:
            count = self.env['res.users'].sudo().search_count([
                ('role_user_ids', 'in', [role.id]),
                ('is_user_role', '=', False),
                ('active', '=', True),
            ])
            max_role_users = max(max_role_users, count)
            top_roles.append({
                'id': role.id,
                'name': role.name or '',
                'users': count,
            })
        top_roles = sorted(top_roles, key=lambda item: item['users'], reverse=True)[:5]
        for role in top_roles:
            role['width'] = round((role['users'] / max_role_users) * 100) if max_role_users else 0

        active_rule_records = self.env['rbac.access.rule'].sudo().search([
            ('active', '=', True),
        ], order='sequence, id desc', limit=5)
        active_rules = []
        for rule in active_rule_records:
            audience = rule.audience_json or {}
            audience_parts = []
            for key, label in (
                ('roles', 'role'),
                ('depts', 'department'),
                ('companies', 'company'),
                ('users', 'user'),
                ('exclude', 'excluded user'),
            ):
                count = len(audience.get(key) or [])
                if count:
                    audience_parts.append('%s %s%s' % (count, label, '' if count == 1 else 's'))
            active_rules.append({
                'id': rule.id,
                'name': rule.name or _('Untitled access rule'),
                'users': ', '.join(audience_parts) or _('All users'),
                'risk': rule.risk or 'low',
            })

        recent_activity = []
        logs = self.env['rbac.audit'].sudo().search([], limit=8, order='create_date desc')
        now = datetime.utcnow()
        for log in logs:
            method = log.method or 'Unknown'
            action_type = method.split('->')[0].strip()
            low = action_type.lower()
            if any(k in low for k in ['add', 'assign', 'grant']):
                indicator = 'added'
            elif any(k in low for k in ['remove', 'revoke', 'deny']):
                indicator = 'removed'
            elif any(k in low for k in ['update', 'modify']):
                indicator = 'modified'
            else:
                indicator = 'neutral'
            recent_activity.append({
                'id': log.id,
                'title': method,
                'subtitle': '%s · by %s' % (log.user_uid.name or 'User', log.create_uid.name or 'System'),
                'ago': self._get_time_passed(log.create_date, now) if log.create_date else '',
                'indicator': indicator,
            })

        pending_cards = []
        for req in pending_requests[:3]:
            pending_cards.append({
                'id': req.id,
                'user_name': req.user_id.name or '',
                'permission': req.group_id.name or req.group_id.full_name or '',
                'description': req.description or '',
                'ago': self._get_time_passed(req.create_date, now) if req.create_date else '',
            })

        request_users = [{
            'id': user.id,
            'name': user.name or '',
            'email': user.email or user.login or '',
        } for user in users]
        request_groups = []
        for group in self.env['res.groups'].sudo().search([], order='privilege_id, name'):
            if group.risk_level == 'critical':
                continue
            request_groups.append({
                'id': group.id,
                'name': group.name or '',
                'full_name': group.full_name or group.name or '',
                'category': group.privilege_id.name if group.privilege_id else 'Other',
            })
        role_groups = []
        seen_role_group_ids = set()
        for app, kind, groups, category_name in self.env['res.groups'].sudo().get_groups_by_application():
            for group in groups:
                if group.id in seen_role_group_ids or group.risk_level == 'critical':
                    continue
                seen_role_group_ids.add(group.id)
                role_groups.append({
                    'id': group.id,
                    'name': group.name or '',
                    'full_name': group.full_name or group.name or '',
                    'category': app.name or '',
                })

        return {
            'stats': {
                'total_users': len(users),
                'users_with_roles': users_with_roles,
                'active_roles': len(roles),
                'base_permissions': role_base_permissions,
                'pending_requests': len(pending_requests),
                'extra_permissions': extra_count,
                'excluded_permissions': excluded_count,
                'total_active_permissions': total_active_permissions,
            },
            'recent_activity': recent_activity,
            'pending_requests': pending_cards,
            'top_roles': top_roles,
            'permission_sources': {
                'base': max(total_active_permissions - extra_count, 0),
                'extra': extra_count,
                'excluded': excluded_count,
            },
            'active_rules': active_rules,
            'request_options': {
                'users': request_users,
                'groups': request_groups,
            },
            'role_options': {
                'users': request_users,
                'groups': role_groups,
            },
        }

    def _get_user_department_name(self, user):
        """Return the linked employee department without forcing an HR dependency."""
        try:
            if 'hr.employee' not in self.env.registry:
                return ''
            employee = self.env['hr.employee'].sudo().search([('user_id', '=', user.id)], limit=1)
            return employee.department_id.name or '' if employee else ''
        except Exception:
            return ''

    def _get_user_permission_breakdown(self, user):
        group_sources = {}
        try:
            group_sources = json.loads(user.group_sources or '{}')
        except Exception:
            group_sources = {}

        extra_groups = user.direct_group_additions
        excluded_groups = user.direct_group_exclusions
        role_groups = user.role_user_ids.mapped('group_ids')
        base_groups = (role_groups & user.group_ids) - extra_groups
        if not base_groups:
            base_groups = user.group_ids - extra_groups

        def permission_payload(group, source_type):
            sources = group_sources.get(str(group.id), [])
            if source_type == 'extra':
                status = '+ Extra'
                dot = 'extra'
            elif source_type == 'excluded':
                status = '- Exclude'
                dot = 'excluded'
            else:
                status = 'Base'
                dot = 'base'
            return {
                'id': group.id,
                'name': group.name or group.full_name or '',
                'full_name': group.full_name or group.name or '',
                'category': group.privilege_id.name if group.privilege_id else 'Other',
                'risk': group.risk_level or 'low',
                'status': status,
                'type': source_type,
                'dot': dot,
                'source': ', '.join(sources) if sources else status,
            }

        permissions = (
            [permission_payload(group, 'base') for group in base_groups]
            + [permission_payload(group, 'extra') for group in extra_groups]
            + [permission_payload(group, 'excluded') for group in excluded_groups]
        )

        categories = {}
        for perm in permissions:
            category = perm['category'] or 'Other'
            data = categories.setdefault(category, {
                'name': category,
                'code': ''.join([part[0] for part in category.split()[:2]]).upper()[:2] or 'OT',
                'total': 0,
                'enabled': 0,
                'permissions': [],
            })
            data['total'] += 1
            if perm['type'] != 'excluded':
                data['enabled'] += 1
            data['permissions'].append(perm)

        rules = [{
            'id': group.id,
            'name': group.name or group.full_name or '',
            'risk': group.risk_level or 'low',
            'applied_via': 'Direct exclusion',
            'tags': [group.name or group.full_name or 'Excluded'],
        } for group in excluded_groups[:6]]

        return {
            'base': len(base_groups),
            'extra': len(extra_groups),
            'excluded': len(excluded_groups),
            'base_group_ids': base_groups.ids,
            'extra_group_ids': extra_groups.ids,
            'excluded_group_ids': excluded_groups.ids,
            'effective_group_ids': user.group_ids.ids,
            'total': len(base_groups) + len(extra_groups) + len(excluded_groups),
            'permissions': permissions,
            'categories': sorted(categories.values(), key=lambda item: item['name']),
            'rules': rules,
        }

    def _get_access_studio_rules_for_user(self, user):
        rules = self.env['rbac.access.rule'].with_context(active_test=False).sudo().search([
            ('active', '=', True),
        ], order='sequence, id desc')
        user_role_ids = set(user.role_user_ids.ids)
        current_company_id = self.env.company.id
        department = self._get_user_department_name(user)
        matching_rules = []

        def ids_from(items):
            return {item.get('id') for item in items if isinstance(item, dict) and item.get('id')}

        def names_from(items):
            return {item.get('name') for item in items if isinstance(item, dict) and item.get('name')}

        for rule in rules:
            audience = rule.audience_json or {}
            excluded_user_ids = ids_from(audience.get('exclude') or [])
            if user.id in excluded_user_ids:
                continue

            role_ids = ids_from(audience.get('roles') or [])
            user_ids = ids_from(audience.get('users') or [])
            company_ids = ids_from(audience.get('companies') or [])
            dept_names = names_from(audience.get('depts') or [])
            if company_ids and current_company_id not in company_ids:
                continue

            matched_by = []
            if user.id in user_ids:
                matched_by.append('Specific user')
            if role_ids & user_role_ids:
                matched_by.append('Assigned role')
            if department and department in dept_names:
                matched_by.append('Department')
            if company_ids and (matched_by or not any([role_ids, user_ids, dept_names])):
                matched_by.append('Company')
            if not any([role_ids, user_ids, company_ids, dept_names]):
                matched_by.append('All users')

            if not matched_by:
                continue

            impact = rule.impact_json or []
            matching_rules.append({
                'id': rule.id,
                'name': rule.name or '',
                'risk': rule.risk or 'low',
                'applied_via': ', '.join(matched_by),
                'tags': [item.get('label') for item in impact if item.get('label')],
            })
        return matching_rules

    def _get_user_access_status(self, user, breakdown, access_rules):
        group_system = self.env.ref('base.group_system', raise_if_not_found=False)
        if group_system and group_system in user.group_ids:
            return {
                'label': 'Full Access',
                'key': 'full',
                'help': 'Super admin user with unrestricted system administration access.',
            }

        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            user=user,
            company=self.env.company,
        )
        model_rules = restrictions.get('model_rules') or {}
        has_model_readonly = any(rule.get('readonly') for rule in model_rules.values())
        if restrictions.get('force_readonly') or has_model_readonly:
            return {
                'label': 'Read-Only Access',
                'key': 'read_only',
                'help': 'This user is covered by read-only RBAC restrictions.',
            }

        global_restriction_keys = (
            'hide_import', 'hide_export', 'hide_spreadsheet', 'hide_add_property',
            'disable_dev_mode', 'hide_technical_settings', 'hide_chatter',
            'hide_send_message', 'hide_log_note', 'hide_activity',
        )
        has_access_studio_restrictions = bool(
            access_rules
            or restrictions.get('hide_menu_ids')
            or restrictions.get('model_names')
            or restrictions.get('field_rules')
            or restrictions.get('domain_rules')
            or restrictions.get('button_rules')
            or restrictions.get('filter_rules')
            or any(restrictions.get(key) for key in global_restriction_keys)
        )
        has_direct_constraints = bool(breakdown.get('excluded') or breakdown.get('extra'))
        if has_access_studio_restrictions or has_direct_constraints:
            return {
                'label': 'Restricted Access',
                'key': 'restricted',
                'help': 'This user has custom RBAC rules or direct permission adjustments.',
            }

        return {
            'label': 'Standard Access',
            'key': 'standard',
            'help': 'Normal operational user with role and base permissions only.',
        }

    def _rbac_user_card(self, user):
        breakdown = self._get_user_permission_breakdown(user)
        access_rules = self._get_access_studio_rules_for_user(user)
        status = self._get_user_access_status(user, breakdown, access_rules)
        department = self._get_user_department_name(user)
        return {
            'id': user.id,
            'name': user.name or '',
            'email': user.email or user.login or '',
            'department': department or 'No Department',
            'roles': [{
                'id': role.id,
                'name': role.name or '',
                'description': role.description or '',
                'permissions_count': len(role.group_ids),
            } for role in user.role_user_ids],
            'base': breakdown['base'],
            'extra': breakdown['extra'],
            'excluded': breakdown['excluded'],
            'base_group_ids': breakdown['base_group_ids'],
            'extra_group_ids': breakdown['extra_group_ids'],
            'excluded_group_ids': breakdown['excluded_group_ids'],
            'effective_group_ids': breakdown['effective_group_ids'],
            'total': breakdown['total'],
            'status': {
                'label': status['label'],
                'key': status['key'],
            },
            'status_help': status['help'],
            'permissions': breakdown['permissions'],
            'categories': breakdown['categories'],
            'rules': access_rules,
        }

    @api.model
    def get_rbac_users_directory(self):
        """Return data for the RBAC Users screen."""
        users = self.env['res.users'].with_context(active_test=False).sudo().search([
            ('is_user_role', '=', False),
            ('active', '=', True),
        ], order='name')
        user_cards = [self._rbac_user_card(user) for user in users]
        departments = sorted(set(card['department'] for card in user_cards if card.get('department')))
        roles = self.env['res.users'].with_context(active_test=False).sudo().search([
            ('is_user_role', '=', True),
            ('active', '=', False),
        ], order='name')
        request_groups = []
        for group in self.env['res.groups'].sudo().search([], order='privilege_id, name'):
            if group.risk_level == 'critical':
                continue
            request_groups.append({
                'id': group.id,
                'name': group.name or '',
                'full_name': group.full_name or group.name or '',
                'category': group.privilege_id.name if group.privilege_id else 'Other',
            })
        return {
            'users': user_cards,
            'departments': departments,
            'roles': [{
                'id': role.id,
                'name': role.name or '',
                'permissions_count': len(role.group_ids),
            } for role in roles],
            'groups': request_groups,
        }

    @api.model
    def get_rbac_user_card(self, user_id):
        user = self.env['res.users'].with_context(active_test=False).sudo().browse(user_id)
        if not (user.exists() and not user.is_user_role and user.active):
            return {}
        return self._rbac_user_card(user)

    @api.model
    def get_rbac_settings(self):
        """Return persisted RBAC settings for the Settings client action."""
        params = self.env['ir.config_parameter'].sudo()
        timeout = params.get_param('rbac_manager.default_approval_timeout', '48')
        auto_expire = params.get_param('rbac_manager.auto_expire_temporary_extras', '1') == '1'
        return {
            'default_approval_timeout': timeout,
            'auto_expire_temporary_extras': auto_expire,
            'timeout_options': [
                {'value': '24', 'label': '24 hours'},
                {'value': '48', 'label': '48 hours'},
                {'value': '72', 'label': '72 hours'},
                {'value': '168', 'label': '7 days'},
            ],
        }

    @api.model
    def set_rbac_settings(self, values):
        """Persist RBAC settings from the Settings client action."""
        params = self.env['ir.config_parameter'].sudo()
        timeout = str(values.get('default_approval_timeout') or '48')
        if timeout not in {'24', '48', '72', '168'}:
            timeout = '48'
        params.set_param('rbac_manager.default_approval_timeout', timeout)
        params.set_param(
            'rbac_manager.auto_expire_temporary_extras',
            '1' if values.get('auto_expire_temporary_extras') else '0',
        )
        return self.get_rbac_settings()

    @api.model
    def get_roles_directory(self):
        """Return all role templates with summary data and the full group catalogue."""
        roles = self.env['res.users'].with_context(active_test=False).sudo().search(
            [('is_user_role', '=', True), ('active', '=', False)], order='name'
        )
        result_roles = []
        for role in roles:
            visible = role.group_ids.filtered(
                lambda g: g.risk_level != 'critical'
            )
            try:
                catalog_count = self.get_role_templates(
                    role.id, page=1, page_size=1
                ).get('total', len(visible))
            except Exception:
                catalog_count = len(visible)
            try:
                assigned_users = self.env['res.users'].sudo().search([
                    ('role_user_ids', 'in', [role.id]),
                    ('is_user_role', '=', False),
                    ('active', '=', True),
                ], order='name')
                users_count = len(assigned_users)
            except Exception:
                assigned_users = self.env['res.users']
                users_count = 0
            result_roles.append({
                'id': role.id,
                'name': role.name or '',
                'description': getattr(role, 'description', '') or '',
                'users_count': users_count,
                'perms_count': catalog_count,
                'selected_perms_count': len(visible),
                'perm_tags': [g.name for g in visible[:5]],
                'group_ids': role.group_ids.ids,
                'user_ids': assigned_users.ids,
                'assigned_users': [{
                    'id': user.id,
                    'name': user.name or '',
                    'email': user.email or user.login or '',
                } for user in assigned_users[:8]],
                'rules': self._get_access_studio_rules_for_role(role),
            })

        all_groups = []
        seen_group_ids = set()
        for app, kind, groups, category_name in self.env['res.groups'].sudo().get_groups_by_application():
            for g in groups:
                if g.id in seen_group_ids or g.risk_level == 'critical':
                    continue
                has_real_category = bool(g.privilege_id and g.privilege_id.category_id)
                seen_group_ids.add(g.id)
                all_groups.append({
                    'id': g.id,
                    'name': g.name or '',
                    'full_name': g.full_name or g.name or '',
                    'category': g.privilege_id.category_id.name if has_real_category else 'Other',
                    'risk_level': g.risk_level or 'low',
                })

        all_users = []
        for user in self.env['res.users'].sudo().search(
            [('is_user_role', '=', False), ('active', '=', True)], order='name'
        ):
            all_users.append({
                'id': user.id,
                'name': user.name or '',
                'email': user.email or user.login or '',
            })

        return {'roles': result_roles, 'all_groups': all_groups, 'all_users': all_users}

    @api.model
    def get_rbac_role_recent_activity(self, role_id, limit=15, offset=0):
        """Return recent role permission changes and user assignment activity."""
        try:
            import pytz

            role = self.env['res.users'].with_context(active_test=False).sudo().browse(role_id).exists()
            if not role or not role.is_user_role:
                return {'error': False, 'records': [], 'limit': limit, 'offset': offset, 'total_count': 0}

            limit = min(max(int(limit or 15), 1), 30)
            offset = max(int(offset or 0), 0)
            logs = self.env['rbac.audit'].sudo().search([
                '|', '|',
                ('user_uid', '=', role.id),
                ('method', 'ilike', '-> %s' % role.name),
                ('method', 'ilike', 'Access Rule'),
            ], order='create_date desc, id desc', limit=500)
            logs = logs.filtered(lambda log: self._rbac_audit_log_related_to_role(log, role))
            total_count = len(logs)
            page = logs[offset:offset + limit]

            tz = pytz.timezone(self.env.user.tz or 'UTC')
            now_utc = datetime.utcnow()
            records = []
            for log in page:
                method = log.method or _('Role activity')
                action = method.split('->')[0].strip() or method
                lower_action = action.lower()
                if any(term in lower_action for term in ('add', 'assign', 'grant', 'create')):
                    indicator = 'added'
                elif any(term in lower_action for term in ('remove', 'revoke', 'delete')):
                    indicator = 'removed'
                else:
                    indicator = 'modified'
                if 'access rule' in lower_action:
                    category = 'Rule'
                    icon = 'fa-shield'
                elif 'role' in lower_action:
                    category = 'Role'
                    icon = 'fa-star-o'
                else:
                    category = 'Permission'
                    icon = 'fa-key'

                message = self._rbac_activity_message(method, category, role.name or '')
                if lower_action.startswith('update role permissions'):
                    message['summary'] = 'Permissions inside this role were changed.'
                changes = []
                for line in log.line_ids:
                    old_value = self._rbac_parse_audit_json(line.old_value) or line.old_value
                    new_value = self._rbac_parse_audit_json(line.new_value) or line.new_value
                    changes.extend(self._rbac_activity_change_messages(
                        line.field_name,
                        line.field_description,
                        old_value,
                        new_value,
                    ))
                    if len(changes) >= 6:
                        break

                local_dt_str = ''
                ago = ''
                if log.create_date:
                    local_dt = log.create_date.replace(tzinfo=pytz.utc).astimezone(tz)
                    local_dt_str = local_dt.strftime("%b %d, %Y at %I:%M %p")
                    ago = self._get_time_passed(log.create_date, now_utc)

                records.append({
                    'id': log.id,
                    'action': message['title'],
                    'details': message['summary'],
                    'subject': message['subject'],
                    'category': category,
                    'icon': icon,
                    'indicator': indicator,
                    'timestamp': local_dt_str,
                    'ago': ago,
                    'performed_by': log.create_uid.name or '',
                    'target': log.user_uid.name or '',
                    'changes': changes[:6],
                })

            return {
                'error': False,
                'records': records,
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
            }
        except Exception as e:
            return {'error': True, 'message': str(e), 'records': []}

    def _get_access_studio_rules_for_role(self, role):
        rules = self.env['rbac.access.rule'].with_context(active_test=False).sudo().search([
            ('active', '=', True),
        ], order='sequence, id desc')
        matching_rules = []
        for rule in rules:
            audience = rule.audience_json or {}
            if self._rbac_rule_audience_matches_role(audience, role):
                impact = rule.impact_json or []
                matching_rules.append({
                    'id': rule.id,
                    'name': rule.name or '',
                    'risk': rule.risk or 'low',
                    'applied_via': 'Assigned role',
                    'tags': [item.get('label') for item in impact if item.get('label')],
                })
        return matching_rules

    def _rbac_audit_log_related_to_role(self, log, role):
        method = log.method or ''
        if log.user_uid.id == role.id:
            return True
        if ('-> %s' % role.name) in method:
            return True
        if 'Access Rule' not in method:
            return False
        rule_name = method.split('->', 1)[1].strip() if '->' in method else ''
        if rule_name:
            rules = self.env['rbac.access.rule'].with_context(active_test=False).sudo().search([
                ('name', '=', rule_name),
            ])
            if any(self._rbac_rule_audience_matches_role(rule.audience_json or {}, role) for rule in rules):
                return True
        for line in log.line_ids:
            if line.field_name != 'audience_json':
                continue
            for raw_value in (line.old_value, line.new_value):
                audience = self._rbac_parse_audit_json(raw_value)
                if self._rbac_rule_audience_matches_role(audience, role):
                    return True
        return False

    def _rbac_rule_audience_matches_role(self, audience, role):
        if not isinstance(audience, dict):
            return False

        def ids_from(items):
            return {item.get('id') for item in items if isinstance(item, dict) and item.get('id')}

        role_ids = ids_from(audience.get('roles') or [])
        return bool(role.id in role_ids)

    @api.model
    def update_role_from_directory(self, role_id, name, description, group_ids, user_ids=None):
        """Update a role template and synchronize assigned regular users."""
        role = self.env['res.users'].with_context(active_test=False).sudo().browse(role_id)
        if not (role.exists() and role.is_user_role and not role.active):
            return False

        target_group_ids = set(group_ids or [])
        role_to_write = role.with_context(active_test=False)
        if set(role.group_ids.ids) != target_group_ids:
            role_audit = self.env['rbac.audit'].create_log(
                self.env['res.users'].with_context(active_test=False).browse(role.id),
                'Update Role Permissions -> %s' % role.name,
            )
            role_to_write = role_to_write.with_context(rbac_audit=role_audit.id)

        role_to_write.write({
            'name': name,
            'description': description or '',
            'group_ids': [[6, 0, group_ids or []]],
        })

        target_users = self.env['res.users'].sudo().browse(user_ids or []).exists().filtered(
            lambda u: not u.is_user_role and u.active
        )
        current_users = self.env['res.users'].sudo().search([
            ('role_user_ids', 'in', [role.id]),
            ('is_user_role', '=', False),
            ('active', '=', True),
        ])
        removed_users = current_users - target_users
        added_users = target_users - current_users
        for user in removed_users:
            self.env['res.users'].with_context(active_test=False).browse(user.id).remove_role(role.id)
        for user in added_users:
            self.env['res.users'].with_context(active_test=False).browse(user.id).assign_role(role.id)
        return True

    @api.model
    def create_role_from_directory(self, name, description, group_ids, user_ids=None):
        """Create a new role template from the Roles Directory modal."""
        import uuid as _uuid
        unique_login = 'role_template_%s' % _uuid.uuid4().hex[:10]
        new_role = self.env['res.users'].with_context(
            active_test=False,
            creating_role_template=True,
        ).sudo().create([{
            'name': name,
            'login': unique_login,
            'active': False,
            'is_user_role': True,
            'description': description or '',
            'group_ids': [[6, 0, group_ids or []]],
        }])
        audit = self.env['rbac.audit'].create_log(new_role, 'Create Role -> %s' % new_role.name)
        group_field = self.env['ir.model.fields'].sudo().search([
            ('model', '=', 'res.users'),
            ('name', '=', 'group_ids'),
        ], limit=1)
        if group_field:
            self.env['rbac.audit.line'].sudo().create({
                'rbac_audit_id': audit.id,
                'field_id': group_field.id,
                'old_value': '[]',
                'new_value': json.dumps([{'id': group.id, 'name': group.name or group.full_name or ''} for group in new_role.group_ids]),
            })
        users = self.env['res.users'].sudo().browse(user_ids or []).exists().filtered(
            lambda u: not u.is_user_role and u.active
        )
        for user in users:
            self.env['res.users'].with_context(active_test=False).browse(user.id).assign_role(new_role.id)
        return new_role.id

    @api.model
    def delete_role_from_directory(self, role_id):
        """Delete a role template and its orphan partner."""
        role = self.env['res.users'].with_context(active_test=False).sudo().browse(role_id)
        if not (role.exists() and role.is_user_role and not role.active):
            return False
        self.env['rbac.audit'].create_log(role, 'Delete Role -> %s' % role.name)
        partner = role.partner_id
        role.sudo().unlink()
        if partner.exists() and not partner.user_ids:
            partner.sudo().unlink()
        return True

    @api.model
    def get_access_studio_data(self):
        """Return lists for Access Studio wizard dropdowns and the rules list."""
        roles = self.env['res.users'].with_context(active_test=False).sudo().search(
            [('is_user_role', '=', True), ('active', '=', False)], order='name'
        )
        users = self.env['res.users'].sudo().search(
            [('is_user_role', '=', False), ('active', '=', True), ('share', '=', False)],
            order='name', limit=300
        )
        menus = self.env['ir.ui.menu'].with_context(ir_ui_menu_full_list=True).sudo().search(
            [], order='name'
        )
        ir_models = self.env['ir.model'].sudo().search(
            [('transient', '=', False)], order='name', limit=500
        )
        companies = self.env['res.company'].sudo().search([], order='name')
        depts = []
        if 'hr.department' in self.env:
            try:
                hr_depts = self.env['hr.department'].sudo().search([], order='name', limit=200)
                depts = [{'id': d.id, 'name': d.name} for d in hr_depts]
            except Exception:
                pass
        rules = self.env['rbac.access.rule'].with_context(active_test=False).sudo().search(
            [], order='sequence, id desc'
        )
        return {
            'roles':     [{'id': r.id, 'name': r.name} for r in roles],
            'users':     [{'id': u.id, 'name': u.name} for u in users],
            'menus':     [{'id': m.id, 'name': m.complete_name or m.name} for m in menus],
            'models':    [{'id': m.id, 'name': m.name, 'model': m.model} for m in ir_models],
            'companies': [{'id': c.id, 'name': c.name} for c in companies],
            'depts':     depts,
            'rules':     [self._access_studio_rule_payload(rule) for rule in rules],
        }

    @api.model
    def get_access_studio_model_fields(self, model_id):
        """Return field choices for a selected Access Studio model."""
        model = self.env['ir.model'].sudo().browse(model_id).exists()
        if not model:
            return []
        fields = self.env['ir.model.fields'].sudo().search(
            [('model_id', '=', model.id), ('name', '!=', 'id')],
            order='field_description, name',
            limit=500,
        )
        return [{
            'id': field.id,
            'name': field.field_description or field.name,
            'field_name': field.name,
            'ttype': field.ttype,
        } for field in fields]

    @api.model
    def get_access_studio_view_nodes(self, model_id):
        """Return button/tab/link choices discovered from model views."""
        model = self.env['ir.model'].sudo().browse(model_id).exists()
        if not model or model.model not in self.env:
            return []
        Model = self.env[model.model].sudo().with_context(rbac_access_bypass=True)
        choices = {}
        views = self.env['ir.ui.view'].sudo().search([
            ('model', '=', model.model),
            ('type', 'in', ['form', 'tree', 'list', 'kanban']),
        ])
        for view in views:
            view_type = 'list' if view.type == 'tree' else view.type
            try:
                arch, _view = Model._get_view(view_id=view.id, view_type=view_type)
            except Exception:
                continue
            doc = etree.fromstring(etree.tostring(arch)) if not isinstance(arch, etree._Element) else arch
            for button in doc.xpath(".//button[@type='object' or @type='action']"):
                label = self._access_studio_node_label(button)
                name = button.get('name')
                button_type = button.get('type')
                if not name or not label:
                    continue
                key = ('button', name, button_type, label)
                choices[key] = {
                    'id': '|'.join(str(part or '') for part in key),
                    'node_type': 'button',
                    'name': label,
                    'attribute_name': name,
                    'attribute_string': label,
                    'button_type': button_type,
                    'is_smart_button': self._access_studio_is_smart_button(button),
                }
            if view_type == 'form':
                for page in doc.xpath(".//page[@string]"):
                    label = page.get('string')
                    key = ('page', page.get('name') or '', '', label)
                    choices[key] = {
                        'id': '|'.join(str(part or '') for part in key),
                        'node_type': 'page',
                        'name': label,
                        'attribute_name': page.get('name') or '',
                        'attribute_string': label,
                        'button_type': '',
                        'is_smart_button': False,
                    }
                for app in doc.xpath(".//app[@string]"):
                    label = app.get('string')
                    key = ('page', app.get('name') or app.get('data-key') or '', '', label)
                    choices[key] = {
                        'id': '|'.join(str(part or '') for part in key),
                        'node_type': 'page',
                        'name': label,
                        'attribute_name': app.get('name') or app.get('data-key') or '',
                        'attribute_string': label,
                        'button_type': '',
                        'is_smart_button': False,
                    }
            for link in doc.xpath(".//a[@type and @name]"):
                label = self._access_studio_node_label(link)
                if not label:
                    continue
                key = ('link', link.get('name'), link.get('type'), label)
                choices[key] = {
                    'id': '|'.join(str(part or '') for part in key),
                    'node_type': 'link',
                    'name': label,
                    'attribute_name': link.get('name'),
                    'attribute_string': label,
                    'button_type': link.get('type'),
                    'is_smart_button': False,
                }
        return sorted(choices.values(), key=lambda item: (item['node_type'], item['name'] or ''))

    @api.model
    def get_access_studio_search_nodes(self, model_id):
        """Return filter and group-by choices discovered from model search views."""
        model = self.env['ir.model'].sudo().browse(model_id).exists()
        if not model or model.model not in self.env:
            return []
        Model = self.env[model.model].sudo().with_context(rbac_access_bypass=True)
        choices = {}
        views = self.env['ir.ui.view'].sudo().search([
            ('model', '=', model.model),
            ('type', '=', 'search'),
        ])
        for view in views:
            try:
                arch, _view = Model._get_view(view_id=view.id, view_type='search')
            except Exception:
                continue
            doc = etree.fromstring(etree.tostring(arch)) if not isinstance(arch, etree._Element) else arch
            for node in doc.xpath(".//filter[@name and @string]"):
                if node.get('invisible') in ('1', 'True', 'true'):
                    continue
                node_type = 'group' if self._access_studio_filter_is_groupby(node) else 'filter'
                label = node.get('string') or node.get('name')
                key = (node_type, node.get('name'), label)
                choices[key] = {
                    'id': '|'.join(str(part or '') for part in key),
                    'node_type': node_type,
                    'name': label,
                    'attribute_name': node.get('name'),
                    'attribute_string': label,
                    'field_name': self._access_studio_search_node_field_name(node),
                }
        return sorted(choices.values(), key=lambda item: (item['node_type'], item['name'] or ''))

    @api.model
    def _access_studio_filter_is_groupby(self, node):
        context = node.get('context') or ''
        return 'group_by' in context

    @api.model
    def _access_studio_search_node_field_name(self, node):
        if node.get('date'):
            return (node.get('date') or '').split(':', 1)[0]
        context = node.get('context') or ''
        if context and 'group_by' in context:
            try:
                group_by = safe_eval(context, {}).get('group_by')
                if isinstance(group_by, (list, tuple)):
                    group_by = group_by[0] if group_by else ''
                if group_by:
                    return str(group_by).split(':', 1)[0]
            except Exception:
                marker = 'group_by'
                after = context[context.find(marker) + len(marker):]
                for quote in ("'", '"'):
                    if quote in after:
                        parts = after.split(quote)
                        if len(parts) > 1:
                            return parts[1].split(':', 1)[0]
        domain = node.get('domain') or ''
        if domain:
            import re
            match = re.search(r"['\"]([a-zA-Z_][\w.]*)['\"]\s*,", domain)
            if match:
                return match.group(1).split('.', 1)[0]
        return node.get('name') or ''

    @api.model
    def _access_studio_node_label(self, node):
        label = node.get('string')
        if label:
            return label.strip()
        texts = []
        for child in node.xpath(".//*[contains(concat(' ', normalize-space(@class), ' '), ' o_stat_text ')] | .//span | .//field[@string]"):
            text = child.get('string') or (child.text or '')
            if text and text.strip():
                texts.append(text.strip())
        if texts:
            return ' '.join(texts)
        text = ''.join(node.itertext()).strip()
        return ' '.join(text.split()) if text else ''

    @api.model
    def _access_studio_is_smart_button(self, node):
        current = node.getparent()
        while current is not None:
            if 'oe_button_box' in (current.get('class') or ''):
                return True
            current = current.getparent()
        return False

    def _access_studio_rule_payload(self, rule):
        audience_detail = rule.audience_json or {}
        impact = rule.impact_json or []
        summary = {
            'users': self._access_studio_rule_sub_label(audience_detail),
        }
        return {
            'id': rule.id,
            'name': rule.name or '',
            'sub': rule.description or summary['users'] or 'New rule',
            'audience': self._access_studio_audience_tags(audience_detail),
            'impact': impact,
            'status': rule.status or ('active' if rule.active else 'draft'),
            'risk': rule.risk or 'low',
            'summary': summary,
            'audience_detail': audience_detail,
            'config': rule.config_json or {},
            'restriction_count': len(impact),
        }

    def _access_studio_audience_tags(self, audience_detail):
        tags = []
        for item in (audience_detail.get('roles') or [])[:2]:
            tags.append({'label': item.get('name') or '', 'type': 'role'})
        for item in (audience_detail.get('users') or [])[:1]:
            tags.append({'label': item.get('name') or '', 'type': 'user'})
        return tags

    def _access_studio_rule_sub_label(self, audience_detail):
        parts = []
        roles = audience_detail.get('roles') or []
        users = audience_detail.get('users') or []
        if roles:
            parts.append('%s role(s)' % ', '.join(item.get('name') or '' for item in roles if item.get('name')))
        if users:
            parts.append('%s direct user(s)' % len(users))
        return ' + '.join(parts) or 'New rule'

    @api.model
    def save_access_studio_rule(self, values):
        """Create or update an Access Studio rule from the custom wizard."""
        rule_id = values.get('id')
        audience = values.get('audience_detail') or {}
        impact = values.get('impact') or []
        config = values.get('config') or {}
        vals = {
            'name': values.get('name') or 'New rule',
            'description': values.get('description') or '',
            'rule_type': values.get('rule_type') or 'Restriction',
            'priority': values.get('priority') or 'Normal (50)',
            'sequence': self._access_studio_priority_sequence(values.get('priority') or 'Normal (50)'),
            'active': bool(values.get('active')),
            'risk': values.get('risk') or 'low',
            'audience_json': audience,
            'impact_json': impact,
            'config_json': config,
        }
        if rule_id:
            rule = self.env['rbac.access.rule'].with_context(
                active_test=False,
                rbac_access_rule_audit_skip=True,
            ).sudo().browse(rule_id)
            if rule.exists():
                old_values = self._access_studio_rule_audit_snapshot(rule)
                rule.write(vals)
                self._access_studio_audit_rule_change(rule, 'Access Rule Updated', old_values, vals)
            else:
                rule = self.env['rbac.access.rule'].with_context(rbac_access_rule_audit_skip=True).sudo().create(vals)
                self._access_studio_audit_rule_change(rule, 'Access Rule Created', {}, vals)
        else:
            rule = self.env['rbac.access.rule'].with_context(rbac_access_rule_audit_skip=True).sudo().create(vals)
            self._access_studio_audit_rule_change(rule, 'Access Rule Created', {}, vals)
        payload = self._access_studio_rule_payload(rule)
        payload['cache_token'] = str(time.time_ns())
        return payload

    @api.model
    def toggle_access_rule_status(self, rule_id):
        """Toggle active/inactive on an Access Studio rule and clear the menu cache."""
        rule = self.env['rbac.access.rule'].with_context(
            active_test=False,
            rbac_access_rule_audit_skip=True,
        ).sudo().browse(rule_id)
        if not rule.exists():
            return None
        old_values = self._access_studio_rule_audit_snapshot(rule)
        rule.write({'active': not rule.active})
        self._access_studio_audit_rule_change(rule, 'Access Rule Status Changed', old_values, {'active': rule.active})
        return {'active': rule.active, 'cache_token': str(time.time_ns())}

    @api.model
    def delete_access_rule(self, rule_id):
        """Delete an Access Studio rule."""
        rule = self.env['rbac.access.rule'].with_context(
            active_test=False,
            rbac_access_rule_audit_skip=True,
        ).sudo().browse(rule_id)
        if not rule.exists():
            return False
        old_values = self._access_studio_rule_audit_snapshot(rule)
        self._access_studio_audit_rule_change(rule, 'Access Rule Deleted', old_values, {})
        rule.unlink()
        return {'deleted': True, 'cache_token': str(time.time_ns())}

    @api.model
    def _access_studio_priority_sequence(self, priority):
        if '100' in str(priority):
            return 100
        if '10' in str(priority):
            return 10
        return 50

    @api.model
    def _access_studio_rule_audit_snapshot(self, rule):
        return {
            'name': rule.name,
            'description': rule.description,
            'rule_type': rule.rule_type,
            'priority': rule.priority,
            'active': rule.active,
            'risk': rule.risk,
            'audience_json': rule.audience_json or {},
            'impact_json': rule.impact_json or [],
            'config_json': rule.config_json or {},
        }

    @api.model
    def _access_studio_audit_rule_change(self, rule, method, old_values, new_values):
        audit = self.env['rbac.audit'].sudo().create_log(self.env.user, '%s -> %s' % (method, rule.name or new_values.get('name') or 'Access Rule'))
        field_model = self.env['ir.model']._get('rbac.access.rule')
        field_names = set(old_values) | set(new_values)
        fields_by_name = {
            field.name: field
            for field in self.env['ir.model.fields'].sudo().search([
                ('model_id', '=', field_model.id),
                ('name', 'in', list(field_names)),
            ])
        }
        for field_name in sorted(field_names):
            field = fields_by_name.get(field_name)
            if not field:
                continue
            old_value = old_values.get(field_name)
            new_value = new_values.get(field_name)
            if old_value == new_value:
                continue
            self.env['rbac.audit.line'].sudo().create({
                'rbac_audit_id': audit.id,
                'field_id': field.id,
                'old_value': self._access_studio_audit_json(old_value),
                'new_value': self._access_studio_audit_json(new_value),
            })

    @api.model
    def _access_studio_audit_json(self, value):
        try:
            return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
        except TypeError:
            return str(value)

    @api.model
    def clone_groups_from_user(self, user_id, clone_user_id):
        try:
            user = self.env['res.users'].browse([user_id])
            clone_user = self.env['res.users'].browse(clone_user_id)
            user.group_ids += clone_user.group_ids
            return {'error': 0,
                    'message': _('Cloned successfully from user %s') % clone_user.name}
        except Exception as e:
            return {'error': ("Clone from user ERROR: " + str(e))}

    @api.model
    def get_initial_rbac_audit(self):
        try:
            logs = []
            actions = set()
            def parse_audit_value(raw_value):
                if raw_value in ('', None):
                    return None
                try:
                    return json.loads(raw_value)
                except Exception:
                    return raw_value

            for x in self.env['rbac.audit'].sudo().search([], order='create_date desc, id desc'):
                group_ids_line = x.line_ids.filtered(lambda z: z.field_name == 'group_ids')
                if x.method:
                    action_type = x.method.split('->')[0].strip()
                else:
                    action_type = 'Unknown'
                actions.add(action_type)
                local_create_date = fields.Datetime.context_timestamp(self, x.create_date) if x.create_date else False
                log = {
                    'id': x.id,
                    'create_datetime_utc': fields.Datetime.to_string(x.create_date) if x.create_date else '',
                    'create_date': [
                        local_create_date.strftime(DEFAULT_SERVER_DATE_FORMAT) if local_create_date else '',
                        local_create_date.strftime(DEFAULT_SERVER_TIME_FORMAT) if local_create_date else '',
                    ],
                    'create_uid': [x.create_uid.name, x.create_uid.email, x.create_uid.id],
                    'user_uid': [x.user_uid.name, x.user_uid.email, x.user_uid.id],
                    'method': x.method,
                    'action': action_type,
                    'ip_address': x.ip_address,
                }
                display_lines = []
                for y in x.line_ids:
                    old_value = parse_audit_value(y.old_value)
                    new_value = parse_audit_value(y.new_value)
                    display_lines.extend(self._rbac_activity_change_messages(
                        y.field_name,
                        y.field_description,
                        old_value,
                        new_value,
                    ))
                log['data_json'] = json.dumps({
                    **log,
                    'ip_address': x.ip_address,
                    'user_agent': x.user_agent,
                    'location': x.location,
                    'len_groups_id': len(json.loads(group_ids_line[-1].new_value.replace("'", '"'))) if group_ids_line else 'N/A',
                    'display_lines': display_lines[:8],
                    'line_ids': [
                        {
                            'field_name': y.field_name,
                            'old_value': y.old_value,
                            'new_value': y.new_value,
                            'is_many': 'many' in y.field_id.ttype,
                        }
                        for y in x.line_ids
                    ]
                })
                logs.append(log)

            user_ids = self.env['rbac.audit'].sudo().search([]).mapped('user_uid')
            users = [{'id': u.id, 'name': u.name or ''} for u in user_ids if u]
            actions_list = sorted(list(actions))
            admin_ids = self.env['rbac.audit'].sudo().search([]).mapped('create_uid')
            admins = [{'id': u.id, 'name': u.name or ''} for u in admin_ids if u]
            return {
                'error': False,
                'logs': logs,
                'users': users,
                'actions_list': actions_list,
                'admins': admins,
            }
        except Exception as e:
            return {
                'error': True,
                'logs': [],
            }
