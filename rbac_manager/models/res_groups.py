# -*- coding: utf-8 -*-
from collections import defaultdict
from lxml.builder import E
from lxml import etree

from odoo import api, fields, models, _
from odoo.exceptions import UserError
from odoo.addons.base.models.res_users import name_boolean_group, name_selection_groups


# ----------------------------------------------------------
# Basic res.groups
# ----------------------------------------------------------

class ResGroups(models.Model):
    _inherit = 'res.groups'

    is_child_permission = fields.Boolean('Permission', default=False)
    full_name = fields.Char(compute='_compute_full_name', store=False, string="Group Name")
    risk_level = fields.Selection([('low', 'low'), ('medium', 'medium'), ('high', 'high')],
                                  string="Risk Level", default='low', required=True)
    description = fields.Text(string="Description")

    @api.depends('category_id', 'name')
    def _compute_full_name(self):
        for group in self:
            group.full_name = f"{group.category_id.name} / {group.name}" if group.category_id else group.name

    def get_toggle_value(self, group_id):
        """Returns True if the current user has the group with the given group_id, otherwise False."""
        group = self.env['res.groups'].browse(group_id)
        if group:
            return group.id in self.env.user.groups_id.ids
        return False

    def check_separator(self, category_name):
        """Checks if any group belongs to the given category name."""
        groups = self.env['res.groups'].search(
            [('category_id.name', '=', category_name),
             ('category_id.is_permission_menu', '=', True)])
        for group in groups:
            if self.get_toggle_value(group.id):
                return True
        return False

    def update_custom_user_groups_view(self):
        """
        Generate dynamic group fields inside a <group string="Permissions"> element
        based on user permissions.
        """
        # Fetch the custom view (view2)
        fields_list = []
        view2 = self.env.ref('rbac_manager.user_groups_view_custom', raise_if_not_found=False)
        if not (view2 and view2._name == 'ir.ui.view'):
            raise UserError(_("The custom user groups view was not found."))

        # Fetch permission groups
        permission_group_ids = self.env['ir.module.category'].sudo().search(
            [('is_permission_menu', '=', True)])
        is_admin = self.env.user.has_group('base.group_system')

        # Prepare XML for Permissions group
        xml_permissions = []

        # Fetch and sort groups by application
        sorted_tuples = sorted(self.get_groups_by_application(),
                               key=lambda t: t[0].xml_id != 'base.module_category_user_type')

        for app, kind, gs, category_name in sorted_tuples:
            # if app.id in permission_group_ids.ids:
            app_name = app.name or 'Other'

            # Add separator for the application
            check_separator = self.check_separator(app_name)
            if check_separator or is_admin:
                xml_permissions.append(E.separator(string=app_name))

            # Left and right column groups
            left_group, right_group = [], []
            group_count = 0

            if kind == 'boolean':
                for g in gs:
                    # if g.is_child_permission:
                    field_name = name_boolean_group(g.id)
                    fields_list.append(field_name)
                    dest_group = left_group if group_count % 2 == 0 else right_group
                    toggle = self.get_toggle_value(g.id)

                    # Skip groups based on toggle and admin status
                    if not toggle and not is_admin:
                        continue

                    dest_group.append(E.field(name=field_name, widget="boolean_toggle"))
                    group_count += 1

            elif kind == 'selection':
                dest_group = left_group
                field_name = name_selection_groups(gs.ids)
                fields_list.append(field_name)
                dest_group.append(E.field(name=field_name))

            # Append left and right groups
            xml_permissions.append(E.group(*left_group))
            xml_permissions.append(E.group(*right_group))

        # Wrap everything inside <group string="Permissions">
        permissions_group = E.group(
            *xml_permissions,
            string="Permissions",
        )
        xml_content = etree.tostring(permissions_group, pretty_print=True, encoding="unicode")
        return xml_content, fields_list

    @api.model
    def get_groups_by_application(self):
        """ Return all groups classified by application (module category), as a list::

                [(app, kind, groups), ...],

            where ``app`` and ``groups`` are recordsets, and ``kind`` is either
            ``'boolean'`` or ``'selection'``. Applications are given in sequence
            order.  If ``kind`` is ``'selection'``, ``groups`` are given in
            reverse implication order.
        """

        def linearize(app, gs, category_name):
            # 'User Type' is an exception
            if app.xml_id == 'base.module_category_user_type':
                return (app, 'selection', gs.sorted('id'), category_name)
            # determine sequence order: a group appears after its implied groups
            order = {g: len(g.trans_implied_ids & gs) for g in gs}
            # We want a selection for Accounting too. Auditor and Invoice are both
            # children of Accountant, but the two of them make a full accountant
            # so it makes no sense to have checkboxes.
            if app.xml_id == 'base.module_category_accounting_accounting':
                return (app, 'selection', gs.sorted(key=order.get), category_name)
            # check whether order is total, i.e., sequence orders are distinct
            if len(set(order.values())) == len(gs):
                return (app, 'boolean', gs.sorted(key=order.get), category_name)
            else:
                return (app, 'boolean', gs, (100, 'Other'))

        # classify all groups by application
        by_app, others = defaultdict(self.browse), self.browse()
        for g in self.get_application_groups([]):
            if g.category_id:
                by_app[g.category_id] += g
            else:
                others += g
        # build the result
        res = []
        for app, gs in sorted(by_app.items(), key=lambda it: it[0].sequence or 0):
            if app.parent_id:
                res.append(linearize(app, gs, (app.parent_id.sequence, app.parent_id.name)))
            else:
                res.append(linearize(app, gs, (100, 'Other')))

        if others:
            res.append((self.env['ir.module.category'], 'boolean', others, (100, 'Other')))
        return res

    def write(self, vals):
        result = super().write(vals)
        return result

    def create(self, vals):
        result = super().create(vals)
        return result

    @api.model
    def get_categories_groups_json(self, user_id):
        sorted_tuples = self.get_groups_by_application()
        res_user = self.env['res.users'].browse([user_id])
        json_dict = {}

        def get_toggle_value(group_id):
            group = self.env['res.groups'].browse(group_id)
            if group:
                return group.id in res_user.groups_id.ids
            return False

        for app, kind, gs, category_name in sorted_tuples:
            app_name = app.name or 'Other'

            if kind == 'boolean':
                json_dict.setdefault(app_name, {}).update({
                    name_boolean_group(g.id): {
                        'group': {'id': g.id, 'name': g.name, 'risk_level': g.risk_level},
                        'groups': False,
                        'value': get_toggle_value(g.id),
                        'values': False,
                        'category_name': str(category_name),
                    }
                    for g in gs
                })

            elif kind == 'selection':
                field_name = name_selection_groups(gs.ids)
                user_group_ids = set(res_user.groups_id.ids)
                group_ids = [g.id for g in reversed(gs) if g.id in user_group_ids]
                last_match = group_ids[0] if len(group_ids) > 0 else False

                json_dict.setdefault(app_name, {}).setdefault(field_name, {}).update({
                    'group': False,
                    'groups': [{'id': group.id, 'name': group.name, 'risk_level': group.risk_level}
                               for group in gs],
                    'value': last_match,
                    'values': list(group_ids),
                    'category_name': str(category_name),
                })

        return json_dict
