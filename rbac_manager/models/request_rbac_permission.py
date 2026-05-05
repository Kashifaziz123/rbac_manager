# -*- coding: utf-8 -*-
from odoo import api, fields, models, exceptions, _
import json


class RequestRbacPermission(models.Model):
    _name = 'request.rbac.permission'
    _description = 'RBAC Permission Request'

    description = fields.Char(string='Description')
    group_id = fields.Many2one('res.groups', string='Group')
    inverse_implied_ids = fields.One2many('res.groups', compute="_compute_inverse_implied_ids")
    user_id = fields.Many2one('res.users', string='User')
    requested_by = fields.Many2one('res.users', string='Requested by')
    approved_by = fields.Many2one('res.users', string='Approved by')
    type = fields.Selection([('grant', 'grant'), ('deny', 'deny')], string="Permission Type")
    state = fields.Selection(
        [('pending', 'pending'), ('approved', 'approved'), ('denied', 'denied')], string="State",
        default='pending')

    def _compute_inverse_implied_ids(self, max_depth=10):
        """Compute groups that imply the selected group (via implied_by_ids chain)."""
        collected = self.env['res.groups']

        def collect_recursive(groups, depth=0):
            nonlocal collected
            if depth >= max_depth or not groups:
                return

            for group in groups:
                collected |= group
                collect_recursive(group.implied_by_ids, depth + 1)

        collect_recursive(self.group_id.implied_by_ids)
        self.inverse_implied_ids = collected

    def state_pending(self):
        self.state = 'pending'

    def state_approved(self):
        self.state = 'approved'
        self.approved_by = self.env.user.id
        self.assign_permission_type()

    def state_denied(self):
        self.state = 'denied'
        self.approved_by = self.env.user.id

    def assign_permission_type(self):
        self.ensure_one()
        if self.type == 'grant':
            self.user_id.add_direct_group_additions(self.group_id.id)
        elif self.type == 'deny':
            self.user_id.add_direct_group_exclusions(self.group_id.id)

    def _request_card_values(self):
        self.ensure_one()
        role = self.user_id.role_user_ids[:1]
        group = self.group_id
        group_label = group.full_name or group.name or ''
        category = ''
        if group.privilege_id:
            category = group.privilege_id.name or ''
            if group.privilege_id.category_id:
                category = group.privilege_id.category_id.name or category
        return {
            'id': self.id,
            'user_id': self.user_id.id,
            'user_name': self.user_id.name or '',
            'user_email': self.user_id.email or self.user_id.login or '',
            'requested_by': self.requested_by.name or '',
            'approved_by': self.approved_by.name or '',
            'group_id': group.id,
            'group_name': group.name or '',
            'group_label': group_label,
            'category': category or 'Other',
            'description': self.description or '',
            'type': self.type or 'grant',
            'state': self.state or 'pending',
            'role_name': role.name if role else 'Direct access',
            'base_count': len(role.sudo().group_ids) if role else len(self.user_id.sudo().group_ids),
            'created_on': self.create_date.strftime('%b %d, %Y') if self.create_date else '',
        }

    @api.model
    def get_requests_dashboard(self):
        requests = self.sudo().search([], order='create_date desc, id desc')
        groups = self.env['res.groups'].sudo().search([], order='privilege_id, name')
        users = self.env['res.users'].sudo().search(
            [('is_user_role', '=', False), ('active', '=', True)], order='name'
        )
        return {
            'requests': [req._request_card_values() for req in requests],
            'counts': {
                'pending': len(requests.filtered(lambda r: r.state == 'pending')),
                'approved': len(requests.filtered(lambda r: r.state == 'approved')),
                'denied': len(requests.filtered(lambda r: r.state == 'denied')),
            },
            'users': [{
                'id': user.id,
                'name': user.name or '',
                'email': user.email or user.login or '',
            } for user in users],
            'groups': [{
                'id': group.id,
                'name': group.name or '',
                'full_name': group.full_name or group.name or '',
                'category': group.privilege_id.name if group.privilege_id else 'Other',
            } for group in groups if group.risk_level != 'critical'],
        }

    @api.model
    def create_request_from_dashboard(self, values):
        values = values or {}
        group_id = int(values.get('group_id') or 0)
        user_id = int(values.get('user_id') or 0)
        request_type = values.get('type') or 'grant'
        if not group_id:
            return {'error': True, 'message': _('Please select a permission.')}
        if not user_id:
            return {'error': True, 'message': _('Please select a user.')}
        if request_type not in ('grant', 'deny'):
            return {'error': True, 'message': _('Please select a request type.')}
        record = self.sudo().create({
            'group_id': group_id,
            'user_id': user_id,
            'type': request_type,
            'description': values.get('description') or '',
            'requested_by': self.env.user.id,
            'state': 'pending',
        })
        return {'error': False, 'id': record.id, 'message': _('Request submitted for approval.')}

    @api.model
    def submit_manage_permission_record(self, values):
        try:
            values = json.loads(values)
            group_id_raw = values.get('group_id', '')
            if not group_id_raw or str(group_id_raw).strip() == '':
                return {'error': True, 'message': _('Please select a permission before submitting.')}
            values['requested_by'] = self.env.user.id
            values['state'] = 'pending'
            values['group_id'] = int(group_id_raw)
            if not values.get('type'):
                return {'error': True, 'message': _('Please select a request type.')}
            self.create(values)
            return {'error': False, 'message': _('Request created successfully.')}
        except Exception as e:
            return {'error': True, 'message': str(e)}
