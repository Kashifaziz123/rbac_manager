import copy

from odoo import api, models


class Base(models.AbstractModel):
    _inherit = 'base'

    @api.model
    def _get_view(self, view_id=None, view_type='form', **options):
        arch, view = super()._get_view(view_id=view_id, view_type=view_type, **options)
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        model_selected = restrictions.get('model_selected')
        readonly = restrictions.get('force_readonly') or model_selected
        if readonly or restrictions.get('hide_import') or restrictions.get('hide_export') or restrictions.get('hide_chatter'):
            arch = copy.deepcopy(arch)

        if readonly and view_type in ('form', 'list', 'tree', 'kanban'):
            arch.set('create', 'false')
            arch.set('edit', 'false')
            arch.set('delete', 'false')
            arch.set('duplicate', 'false')

        if view_type in ('list', 'tree', 'kanban'):
            if restrictions.get('hide_import') or model_selected:
                arch.set('import', 'false')
            if restrictions.get('hide_export') or model_selected:
                arch.set('export_xlsx', 'false')

        if view_type == 'form' and restrictions.get('hide_chatter'):
            self._rbac_hide_chatter_nodes(arch)

        return arch, view

    @api.model
    def _rbac_hide_chatter_nodes(self, arch):
        for node in arch.xpath("//div[contains(concat(' ', normalize-space(@class), ' '), ' oe_chatter ')]"):
            parent = node.getparent()
            if parent is not None:
                parent.remove(node)
