# -*- coding: utf-8 -*-
from odoo.tools import DEFAULT_SERVER_DATE_FORMAT, DEFAULT_SERVER_TIME_FORMAT
from odoo import api, fields, models, exceptions, _
from dateutil.relativedelta import relativedelta
from datetime import datetime
import json

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
            for x in self.env['rbac.audit'].sudo().search([]):
                group_ids_line = x.line_ids.filtered(lambda z: z.field_name == 'group_ids')
                if x.method:
                    action_type = x.method.split('->')[0].strip()
                else:
                    action_type = 'Unknown'
                actions.add(action_type)
                log = {
                    'id': x.id,
                    'create_date': [x.create_date.strftime(DEFAULT_SERVER_DATE_FORMAT),
                                    x.create_date.strftime(DEFAULT_SERVER_TIME_FORMAT)],
                    'create_uid': [x.create_uid.name, x.create_uid.email, x.create_uid.id],
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
                    'len_groups_id': len(json.loads(group_ids_line[-1].new_value.replace("'", '"'))) if group_ids_line else 'N/A',
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
