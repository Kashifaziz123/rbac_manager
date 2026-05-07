from odoo.addons.web.controllers.action import Action
from odoo.addons.web.controllers.dataset import DataSet
from odoo.http import request, route
from odoo.service.model import call_kw
from odoo.service.server import thread_local

from odoo.addons.web.controllers.utils import clean_action


class RbacDataSet(DataSet):

    def _rbac_check_button_method(self, model, method):
        access_rule = request.env['rbac.access.rule']
        if access_rule.is_button_method_blocked(model, method):
            access_rule.raise_button_blocked(model, method)

    @route(['/web/dataset/call_kw', '/web/dataset/call_kw/<path:path>'], type='jsonrpc', auth="user", readonly=DataSet._call_kw_readonly)
    def call_kw(self, model, method, args, kwargs, path=None):
        self._rbac_check_button_method(model, method)
        if path != f'{model}.{method}':
            thread_local.rpc_model_method = f'{model}.{method}'
        return call_kw(request.env[model], method, args, kwargs)

    @route(['/web/dataset/call_button', '/web/dataset/call_button/<path:path>'], type='jsonrpc', auth="user", readonly=DataSet._call_kw_readonly)
    def call_button(self, model, method, args, kwargs, path=None):
        self._rbac_check_button_method(model, method)
        if path != f'{model}.{method}':
            thread_local.rpc_model_method = f'{model}.{method}'
        action = call_kw(request.env[model], method, args, kwargs)
        if isinstance(action, dict) and action.get('type') != '':
            return clean_action(action, env=request.env)
        return False


class RbacAction(Action):

    @route('/web/action/load', type='jsonrpc', auth='user', readonly=True)
    def load(self, action_id, context=None):
        resolved_id = self._rbac_resolve_action_id(action_id)
        if resolved_id and request.env['rbac.access.rule'].is_action_blocked(resolved_id):
            request.env['rbac.access.rule'].raise_action_blocked(resolved_id)
        return super().load(action_id, context=context)

    def _rbac_resolve_action_id(self, action_id):
        try:
            return int(action_id)
        except (TypeError, ValueError):
            pass
        try:
            if isinstance(action_id, str) and '.' in action_id:
                action = request.env.ref(action_id, raise_if_not_found=False)
            else:
                action = request.env['ir.actions.actions'].sudo().search([('path', '=', action_id)], limit=1)
        except Exception:
            action = request.env['ir.actions.actions']
        return action.id if action and action._name.startswith('ir.actions.') else False
