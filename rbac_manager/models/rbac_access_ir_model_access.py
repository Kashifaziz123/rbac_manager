from odoo import api, models


class IrModelAccess(models.Model):
    _inherit = 'ir.model.access'

    @api.model
    def check(self, model, mode='read', raise_exception=True):
        if mode in ('create', 'write', 'unlink') and self.env['rbac.access.rule'].is_operation_blocked(model, mode):
            if raise_exception:
                self.env['rbac.access.rule'].raise_operation_blocked(model, mode)
            return False
        return super().check(model, mode=mode, raise_exception=raise_exception)
