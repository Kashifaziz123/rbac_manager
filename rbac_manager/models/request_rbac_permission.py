# -*- coding: utf-8 -*-
from odoo import api, fields, models, exceptions, _
import json


class RequestRbacPermission(models.Model):
    _name = 'request.rbac.permission'

    description = fields.Char(string='Description')
    group_id = fields.Many2one('res.groups', string='Group')
    user_id = fields.Many2one('res.users', string='Requested by')
    requested_by = fields.Many2one('res.users', string='Requested by')
    approved_by = fields.Many2one('res.users', string='Approved by')
    type = fields.Selection([('grant', 'grant'), ('deny', 'deny')], string="Permission Type")
    state = fields.Selection(
        [('pending', 'pending'), ('approved', 'approved'), ('denied', 'denied')], string="State")

    @api.model
    def submit_manage_permission_record(self, values):
        try:
            values = json.loads(values)
            values['requested_by'] = self.env.user.id
            values['state'] = 'pending'
            values['group_id'] = int(values['group_id'])
            self.create(values)
            return {'error': False, 'message': 'Request created'}
        except Exception as e:
            return {'error': True, 'message': str(e)}
