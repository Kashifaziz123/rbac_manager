import json

from odoo import http
from odoo.addons.web.controllers.home import Home
from odoo.addons.web.controllers.utils import ensure_db
from odoo.http import request


def _rbac_current_company_ids():
    cids = request.httprequest.cookies.get('cids') or ''
    company_ids = []
    for cid in cids.replace(',', '-').split('-'):
        if cid.isdigit():
            company_ids.append(int(cid))
    allowed_ids = set(request.env.user.company_ids.ids)
    return [cid for cid in company_ids if cid in allowed_ids]


def _rbac_request_env_with_active_companies():
    company_ids = _rbac_current_company_ids()
    if not company_ids:
        return request.env
    return request.env(context=dict(request.env.context, allowed_company_ids=company_ids))


class RbacHome(Home):

    @http.route(
        ['/web', '/odoo', '/odoo/<path:subpath>', '/scoped_app/<path:subpath>'],
        type='http',
        auth='none',
        readonly=Home._web_client_readonly,
    )
    def web_client(self, s_action=None, **kw):
        ensure_db()
        if request.session.uid and kw.get('debug') not in (None, '', '0', 'false', 'False'):
            request.update_env(user=request.session.uid)
            env = _rbac_request_env_with_active_companies()
            restrictions = env['rbac.access.rule'].sudo().get_access_restrictions(
                user=env.user,
                company=env.company,
            )
            if restrictions.get('disable_dev_mode'):
                return request.redirect('/web?debug=0', 303)
        return super().web_client(s_action=s_action, **kw)

    @http.route('/web/webclient/load_menus', type='http', auth='user', methods=['GET'], readonly=True)
    def web_load_menus(self, lang=None):
        if lang:
            request.update_context(lang=lang)
        menu_env = _rbac_request_env_with_active_companies()
        menus = menu_env["ir.ui.menu"].load_web_menus(request.session.debug)
        response = request.make_response(json.dumps(menus), [
            ('Content-Type', 'application/json'),
            ('Cache-Control', 'no-store'),
        ])
        return response


class RbacAccessController(http.Controller):

    @http.route('/rbac/access/global_flags', type='json', auth='user')
    def global_flags(self, company_key=None):
        env = _rbac_request_env_with_active_companies()
        restrictions = env['rbac.access.rule'].sudo().get_access_restrictions(
            user=env.user,
            company=env.company,
        )
        return {
            key: bool(restrictions.get(key))
            for key in (
                'force_readonly',
                'hide_import',
                'hide_export',
                'hide_spreadsheet',
                'hide_add_property',
                'disable_dev_mode',
                'hide_technical_settings',
                'hide_chatter',
                'hide_send_message',
                'hide_log_note',
                'hide_activity',
            )
        }

    @http.route('/rbac/access/search_restrictions', type='json', auth='user')
    def search_restrictions(self, res_model=None, company_key=None):
        if not res_model:
            return {'filter_fields': [], 'group_fields': []}
        env = _rbac_request_env_with_active_companies()
        restrictions = env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=res_model,
            user=env.user,
            company=env.company,
        )
        filter_fields = set()
        group_fields = set()
        for rule in restrictions.get('filter_rule') or []:
            field_name = rule.get('field_name') or rule.get('attribute_name')
            if not field_name:
                continue
            if rule.get('node_type') == 'group':
                group_fields.add(field_name)
            else:
                filter_fields.add(field_name)
        return {
            'filter_fields': sorted(filter_fields),
            'group_fields': sorted(group_fields),
        }
