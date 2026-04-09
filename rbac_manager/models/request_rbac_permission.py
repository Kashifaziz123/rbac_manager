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
