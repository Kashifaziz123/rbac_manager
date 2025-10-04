# -*- coding: utf-8 -*-
from odoo import api, fields, models, exceptions, _


class RequestRbacPermission(models.Model):
    _name = 'request.rbac.permission'

    description = fields.Char(string='Description')
    group_id = fields.Many2one('res.groups', string='Group')
    user_id = fields.Many2one('res.users', string='Requested by')
    approved_by = fields.Many2one('res.users', string='Approved by')
    type = fields.Selection([('grant','grant'), ('deny','deny')], string="Permission Type")
