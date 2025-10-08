# -*- coding: utf-8 -*-
from odoo import api, fields, models, exceptions, _
from dateutil.relativedelta import relativedelta
from datetime import datetime
import json


# ----------------------------------------------------------
# Basic res.users
# ----------------------------------------------------------

class RbacModel(models.Model):
    _name = 'rbac.model'

    def _get_time_passed(dt, now=None):
        if not dt:
            return "0 minutes"

        if now is None:
            now = datetime.utcnow()

        future = dt > now
        start, end = (now, dt) if future else (dt, now)
        rd = relativedelta(end, start)

        if rd.years >= 1:
            pair = (("year", rd.years), ("month", rd.months))
        elif rd.months >= 1:
            pair = (("month", rd.months), ("day", rd.days))
        elif rd.days >= 1:
            pair = (("day", rd.days), ("hour", rd.hours))
        else:
            pair = (("hour", rd.hours), ("minute", rd.minutes))

        p = lambda n, s: f"{n}{s}{'s' * (n != 1)}"
        # build result with only non-zero parts
        a, b = pair
        parts = ([p(a[1], a[0])] if a[1] else []) + ([p(b[1], b[0])] if b[1] else [])

        if not parts:
            parts = ["0minutes"]

        return ("-" if future else "") + " ".join(parts)

    def _get_employee(self):
        try:
            employee = self.env['hr.employee'].sudo().search([('user_id', '=', self.id)])
            return {'barcode': employee.barcode}
        except:
            return {}

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
                    'categories': json.dumps(user.groups_id.mapped('category_id.name'))
                })
        except:
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
                {"name": "groups_id/.id", "label": "Groups/ID", "type": "integer"},
                {"name": "groups_id/id", "label": "Groups/External ID", "type": "many2many"},
                {"name": "groups_id/name", "label": "Groups/Name", "type": "char"},
                {"name": "groups_id/risk_level", "label": "Groups/Risk Level", "type": "selection"}
            ], "groupby": [], "ids": [user_id], "model": "res.users"
        }
        return data

    @api.model
    def get_user_permissions_json(self, user_id):
        try:
            self_user = self.env['res.users'].with_context(active_test=False).browse([user_id])
            groups = self_user.sudo().groups_id
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
                        'permissions_count': len(user.sudo().groups_id)
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
        except:
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
                        'permissions_count': len(user.sudo().groups_id)
                    } for user in
                    (self_user.search([('active', '=', False),
                                       ('is_user_role', '=', True)]) - self_user.role_user_ids)
                ],
                'assigned_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().groups_id)
                    } for user in self_user.role_user_ids
                ],
                'employee': self._get_employee(),
                'error': False,
                'permissions': {
                    'deny': [{'id': group.id, 'name': group.name} for group in self_user.groups_id],
                    'grant': [{'id': group.id, 'name': group.name} for group in
                              (self.env['res.groups'].search([]) - self_user.groups_id)]
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
            groups = self_user.sudo().groups_id
            categories = groups.get_categories_groups_json(user_id)

            return {
                'available_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().groups_id)
                    } for user in
                    (self_user.search([('active', '=', False),
                                       ('is_user_role', '=', True)]) - self_user.role_user_ids)
                ],
                'assigned_roles': [
                    {
                        'id': user.id,
                        'name': user.name,
                        'description': user.description or "",
                        'permissions_count': len(user.sudo().groups_id)
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
            }
        except:
            return {
                'available_roles': [],
                'assigned_roles': [],
                'all_categories': [],
                'employee': {},
                'error': True,
                'group_sources': json.dumps({}),
                'roles': {},
            }

    @api.model
    def clone_groups_from_user(self, user_id, clone_user_id):
        try:
            user = self.env['res.users'].browse([user_id])
            clone_user_id = self.env['res.users'].browse(clone_user_id)
            user.groups_id += clone_user_id.groups_id
            return {'error': 0,
                    'message': _('Cloned successfully from user %s') % clone_user_id.name}
        except Exception as e:
            return {'error': ("Clone from user %s ERROR: " + str(e)) % clone_user_id.name}
