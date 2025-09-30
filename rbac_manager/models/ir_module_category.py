# -*- coding: utf-8 -*-
from odoo import fields, models


class ModuleCategory(models.Model):
    _inherit = "ir.module.category"

    is_permission_menu = fields.Boolean('Permission Menu', default=False)
    child_group_ids = fields.One2many('res.groups', 'category_id', string='Groups')

    def write(self, vals):
        result = super(ModuleCategory, self).write(vals)

        if 'is_permission_menu' in vals:
            for record in self:
                record._update_related_user_groups(record.name)
        for record in self:
            if any(child.is_child_permission for child in record.child_group_ids):
                record._update_related_user_groups(record.name)
        return result

    def _update_related_user_groups(self, category_name):
        """
        Helper method to update user groups based on the category name.
        """
        res_group = self.env['res.groups'].sudo().search(
            [('category_id.name', '=', category_name)], limit=1
        )
        if res_group:
            res_group._update_user_groups_view()
