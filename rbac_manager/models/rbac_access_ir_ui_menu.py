from odoo import models


class IrUiMenu(models.Model):
    _inherit = 'ir.ui.menu'

    def _load_menus_blacklist(self):
        hidden_ids = set(super()._load_menus_blacklist())
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            user=self.env.user,
            company=self.env.company,
        )
        hidden_ids.update(restrictions.get('hide_menu_ids') or set())
        if restrictions.get('hide_technical_settings'):
            for xmlid in ('base.menu_administration', 'base.menu_management'):
                menu = self.env.ref(xmlid, raise_if_not_found=False)
                if menu:
                    hidden_ids.add(menu.id)
        if restrictions.get('hide_spreadsheet'):
            spreadsheet_menus = self.sudo().search([
                '|',
                ('name', 'ilike', 'spreadsheet'),
                ('action', 'ilike', 'spreadsheet'),
            ])
            hidden_ids.update(spreadsheet_menus.ids)
        return list(hidden_ids)
