# -*- coding: utf-8 -*-
from odoo.tools import DEFAULT_SERVER_DATE_FORMAT, DEFAULT_SERVER_TIME_FORMAT
from odoo import api, fields, models, exceptions, _
from dateutil.relativedelta import relativedelta
from datetime import datetime, timedelta
import pytz
import json


max_depth = 10


class RbacModel(models.Model):
    _name = 'rbac.model'

    def _compute_inverse_implied_ids(self, inverse_implied_ids, max_depth=10):
        collected = []

        def collect_recursive(groups, depth=0):
            nonlocal collected
            if depth >= max_depth or not groups:
                return

            for group in groups:
                collected.append(group)
                collect_recursive(group.inverse_implied_ids, depth + 1)

        collect_recursive(inverse_implied_ids)
        return collected

    @api.model
    def get_filtered_audit_logs(self, filters):
        domain = []
        if filters.get('user_id'):
            domain.append(('user_uid', '=', int(filters['user_id'])))
        if filters.get('admin_id'):
            domain.append(('create_uid', '=', int(filters['admin_id'])))
        if filters.get('from') and filters.get('to'):
            domain += [
                ('create_date', '>=', filters['from'] + ' 00:00:00'),
                ('create_date', '<=', filters['to'] + ' 23:59:59')
            ]
        logs = self.env['rbac.audit'].sudo().search(domain, order="create_date desc")

        return [{
            'create_date': [l.create_date.strftime('%Y-%m-%d'), l.create_date.strftime('%H:%M:%S')],
            'create_uid': [l.create_uid.name, l.create_uid.email, l.create_uid.id],
            'user_uid': [l.user_uid.name or '', l.user_uid.email or '', l.user_uid.id if l.user_uid else ''],
            'method': l.method or '',
            'ip_address': l.ip_address or '',
        } for l in logs]

    @api.model
    def get_audit_filter_data(self):
        """Fetch static dropdown filter data once (optimized with read_group)."""
        try:
            Audit = self.env["rbac.audit"].sudo()

            # Users
            user_groups = Audit.read_group([], ["user_uid"], ["user_uid"])
            users = [
                {"id": g["user_uid"][0], "name": g["user_uid"][1]}
                for g in user_groups if g["user_uid"]
            ]

            # Admins
            admin_groups = Audit.read_group([], ["create_uid"], ["create_uid"])
            admins = [
                {"id": g["create_uid"][0], "name": g["create_uid"][1]}
                for g in admin_groups if g["create_uid"]
            ]

            # Actions
            methods = Audit.search([("method", "!=", False)]).mapped("method")
            actions = sorted({m.split("->")[0].strip() for m in methods if m})

            return {
                "error": False,
                "users": users,
                "admins": admins,
                "actions_list": actions,
            }
        except Exception as e:
            return {"error": True, "message": str(e)}

    @api.model
    def get_paginated_audit_logs(self, filters):
        try:
            page = int(filters.get("page", 1))
            limit = int(filters.get("limit", 10))
            offset = (page - 1) * limit

            domain = []

            # 🔍 Apply filters
            if filters.get("search"):
                term = filters["search"]
                domain += ["|", ("method", "ilike", term), ("user_uid.name", "ilike", term)]
            if filters.get("user_id"):
                domain.append(("user_uid", "=", int(filters["user_id"])))
            if filters.get("admin_id"):
                domain.append(("create_uid", "=", int(filters["admin_id"])))
            if filters.get("from") and filters.get("to"):
                domain.append(("create_date", ">=", filters["from"]))
                domain.append(("create_date", "<=", filters["to"]))

            # ⚙️ Fetch logs with pagination
            logs = (
                self.env["rbac.audit"]
                .sudo()
                .search(domain, order="create_date desc", offset=offset, limit=limit)
            )
            total = self.env["rbac.audit"].sudo().search_count(domain)

            result_logs = []

            for x in logs:
                groups_id = x.line_ids.filtered(lambda z: z.field_name == "groups_id")
                action_type = x.method.split("->")[0].strip() if x.method else "Unknown"

                log = {
                    "id": x.id,
                    "create_date": [
                        x.create_date.strftime(DEFAULT_SERVER_DATE_FORMAT),
                        x.create_date.strftime(DEFAULT_SERVER_TIME_FORMAT),
                    ],
                    "create_uid": [x.create_uid.name, x.create_uid.email, x.create_uid.id],
                    "user_uid": [x.user_uid.name, x.user_uid.email, x.user_uid.id],
                    "method": x.method,
                    "action": action_type,
                    "ip_address": x.ip_address,
                }

                # 🔹 Include the detailed payload
                log["data_json"] = json.dumps(
                    {
                        **log,
                        "ip_address": x.ip_address,
                        "user_agent": x.user_agent,
                        "location": x.location,
                        "len_groups_id": len(
                            json.loads(groups_id[-1].new_value.replace("'", '"'))
                        )
                        if groups_id
                        else "N/A",
                        "line_ids": [
                            {
                                "field_name": y.field_name,
                                "old_value": y.old_value,
                                "new_value": y.new_value,
                                "is_many": "many" in y.field_id.ttype,
                            }
                            for y in x.line_ids
                        ],
                    }
                )

                result_logs.append(log)

            # ✅ Base response only (no dropdowns)
            return {
                "error": False,
                "logs": result_logs,
                "total": total,
                "limit": limit,
            }

        except Exception as e:
            return {"error": True, "message": str(e), "logs": []}

    @api.model
    def get_filtered_permissions(self, user_id, mode='all'):
        """
        Returns filtered permission structure based on the mode:
        all, granted, denied, high, overrides
        """
        user = self.env['res.users'].browse(user_id)
        base_data = self.get_rbac_super_admin_json(user_id)

        # Apply same filters as JS had
        if mode == 'granted':
            filtered = {k: v for k, v in base_data['all_categories'].items()
                        if v.get('value') not in [False, None]}
        elif mode == 'denied':
            filtered = {k: v for k, v in base_data['all_categories'].items()
                        if v.get('value') is False}
        elif mode == 'high':
            filtered = {k: v for k, v in base_data['all_categories'].items()
                        if v.get('group', {}).get('risk_level') == 'high'}
        elif mode == 'overrides':
            # example: direct_add or excluded
            filtered = {k: v for k, v in base_data['all_categories'].items()
                        if base_data['group_sources'].get(k) in ['direct_add', 'excluded']}
        else:
            filtered = base_data['all_categories']

        # also compute total counts once, server-side
        totals = {
            'all_groups_count': sum(len(x.get('groups', [])) for x in filtered.values()),
            'is_granted': sum(1 for x in filtered.values() if x.get('value')),
            'is_denied': sum(1 for x in filtered.values() if x.get('value') is False),
            'is_high_risk': sum(1 for x in filtered.values() if x.get('group', {}).get('risk_level') == 'high'),
        }

        return {
            'filtered': filtered,
            'totals': totals,
        }

    def _get_time_passed(self, dt, now=None):
        if not dt:
            return "Just now"

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
            pair = ((" day", rd.days), (" hour", rd.hours))
        else:
            pair = ((" hour", rd.hours), (" minute", rd.minutes))

        p = lambda n, s: f"{n}{s}{'s' * (n != 1)}"
        a, b = pair
        parts = ([p(a[1], a[0])] if a[1] else []) + ([p(b[1], b[0])] if b[1] else [])

        # 🟢 Fix: Replace "0 minutes" with "Just now"
        if not parts or (len(parts) == 1 and parts[0] == "0 minutes"):
            return "Just now"

        return ("in " if future else "") + " ".join(parts) + ("" if future else " ago")

    def _get_employee(self):
        try:
            employee = self.env['hr.employee'].sudo().search([('user_id', '=', self.id)])
            return {'barcode': employee.barcode}
        except:
            return {}

    def _get_user_type(self, user):
        user_type = ""
        for x in ['base.group_user', 'base.group_portal', 'base.group_public']:
            if self.env.ref(x).id in user.groups_id.ids:
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
    def get_role_templates(self, user_id):
        try:
            categories_groups_json = self.env['res.groups'].get_categories_groups_json(user_id)

            result = {}
            for category, content in categories_groups_json.items():
                result[category] = {}
                for name, data in content.items():
                    if data['groups'] is False:
                        if data['group'] and data['group']['risk_level'] != 'critical':
                            result[category][name] = data
                    else:
                        filtered = [g for g in data['groups'] if g['risk_level'] != 'critical']
                        if filtered:
                            result[category][name] = {**data, 'groups': filtered}

                if not result[category]:
                    del result[category]

            return result
        except Exception as e:
            return {}

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
                    'deny': [{'id': group.id, 'name': group.name} for group in
                             self_user.groups_id],
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
                'inverse_implied_ids': {
                    group.id: [g.name for g in
                               self._compute_inverse_implied_ids(group.inverse_implied_ids)]
                    for group in self.env['res.groups'].search([])
                },
                'user_type': self._get_user_type(self_user),
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
                'inverse_implied_ids': {},
                'user_type': '',
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

    @api.model
    def get_initial_rbac_audit(self):
        try:
            logs = []
            actions = set()
            for x in self.env['rbac.audit'].sudo().search([]):
                groups_id = x.line_ids.filtered(lambda z: z.field_name == 'groups_id')
                if x.method:
                    action_type = x.method.split('->')[0].strip()
                else:
                    action_type = 'Unknown'
                actions.add(action_type)
                log = {
                    'id': x.id,
                    'create_date': [x.create_date.strftime(DEFAULT_SERVER_DATE_FORMAT),
                                    x.create_date.strftime(DEFAULT_SERVER_TIME_FORMAT)],
                    'create_uid': [x.create_uid.name, x.create_uid.email,x.create_uid.id],
                    'user_uid': [x.user_uid.name, x.user_uid.email, x.user_uid.id],
                    'method': x.method,
                    'action': action_type,
                    'ip_address': x.ip_address,
                }
                log['data_json'] = json.dumps({
                    **log,
                    'ip_address': x.ip_address,
                    'user_agent': x.user_agent,
                    'location': x.location,
                    'len_groups_id': len(json.loads(groups_id[-1].new_value.replace("'", '"'))) if groups_id else 'N/A',
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
                'actions_list':actions_list,
                'admins': admins,
            }
        except Exception as e:
            return {
                'error': True,
                'logs': [],
            }

    @api.model
    def get_recent_audit_changes(self, user_id, limit=10, offset=0):
        """Paginated audit logs with total count for 'Load More' button."""
        try:
            import pytz
            from datetime import datetime, timedelta

            user_tz = self.env.user.tz or 'UTC'
            tz = pytz.timezone(user_tz)
            now_utc = datetime.utcnow()
            thirty_days_ago = now_utc - timedelta(days=30)

            domain = [
                ('user_uid', '=', user_id),
                ('create_date', '>=', thirty_days_ago),
            ]

            total_count = self.env['rbac.audit'].sudo().search_count(domain)
            logs = self.env['rbac.audit'].sudo().search(domain, limit=limit, offset=offset, order='create_date desc')

            recent_changes = []
            for log in logs:
                if not log.create_date:
                    continue
                utc_dt = log.create_date.replace(tzinfo=pytz.utc)
                local_dt = utc_dt.astimezone(tz)
                local_dt_str = local_dt.strftime("%b %d, %Y at %I:%M %p")

                method = log.method or "Unknown"
                action_type = method.split('->')[0].strip()
                if any(k in action_type.lower() for k in ['add', 'assign']):
                    indicator = 'added'
                elif any(k in action_type.lower() for k in ['remove', 'revoke']):
                    indicator = 'removed'
                elif any(k in action_type.lower() for k in ['update', 'modify']):
                    indicator = 'modified'
                else:
                    indicator = 'neutral'

                recent_changes.append({
                    'action': action_type,
                    'details': method,
                    'timestamp': local_dt_str,
                    'ago': self._get_time_passed(log.create_date, now_utc),  # ✅ use existing helper
                    'performed_by': log.create_uid.name,
                    'indicator': indicator,
                })

            return {
                'error': False,
                'records': recent_changes,
                'limit': limit,
                'offset': offset,
                'total_count': total_count,
            }

        except Exception as e:
            return {'error': True, 'message': str(e), 'records': []}