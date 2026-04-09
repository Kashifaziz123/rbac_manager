# -*- coding: utf-8 -*-
from odoo import api, fields, models, exceptions, _
from odoo.fields import Many2one
from odoo.http import GeoIP, request, root
from dateutil.relativedelta import relativedelta
from datetime import datetime
import json

max_depth = 10


class RbacAudit(models.Model):
    _name = 'rbac.audit'
    _description = 'RBAC Audit'

    create_uid = fields.Many2one('res.users', string='Performed By', readonly=True)
    create_date = fields.Datetime(string='Performed at', readonly=True)
    user_uid = fields.Many2one('res.users', string='Performed on', readonly=True)

    ip_address = fields.Char("IP Address")
    user_agent = fields.Char("user_agent")
    location = fields.Char("Location")
    method = fields.Char(size=64)
    action_type = fields.Selection([
        ('Role Added', 'Role Added'), ('Role Removed', 'Role Removed'),
        ('Extra Added', 'Extra Added'), ('Extra Removed', 'Extra Removed'),
        ('Exclude Added', 'Exclude Added'), ('Exclude Removed', 'Exclude Removed'),
    ])
    line_ids = fields.One2many("rbac.audit.line", "rbac_audit_id", string="Fields updated")

    def create_log(self, user, method):
        try:
            ip_address = request.httprequest.remote_addr
            geoip = GeoIP(ip_address)
            # Odoo 19: use attribute access instead of deprecated dict API
            country = geoip.country_name or 'N/A'
            try:
                city = geoip.city.name or 'N/A'
            except Exception:
                city = 'N/A'
            location = f"{country},{city}"
            user_agent = str(request.httprequest.user_agent)
        except Exception:
            ip_address = 'N/A'
            location = 'N/A'
            user_agent = 'N/A'

        return self.create({
            'ip_address': ip_address,
            'user_agent': user_agent,
            'location': location,
            'method': method,
            'user_uid': user.id,
        })


class RbacAuditLine(models.Model):
    _name = 'rbac.audit.line'
    _description = 'RBAC Audit Line'

    rbac_audit_id = fields.Many2one('rbac.audit', ondelete="cascade", index=True)
    field_id = fields.Many2one('ir.model.fields', ondelete='cascade', string="Field",
                               required=True)
    field_name = fields.Char("Technical name", related='field_id.name')
    field_description = fields.Char("Description", related='field_id.field_description')

    old_value = fields.Text()
    new_value = fields.Text()
