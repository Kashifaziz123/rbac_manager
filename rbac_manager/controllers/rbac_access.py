from odoo import http
from odoo.addons.web.controllers.home import Home
from odoo.addons.web.controllers.utils import ensure_db
from odoo.http import request


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
            restrictions = request.env['rbac.access.rule'].sudo().get_access_restrictions(
                user=request.env.user,
                company=request.env.company,
            )
            if restrictions.get('disable_dev_mode'):
                return request.redirect('/web?debug=0', 303)
        return super().web_client(s_action=s_action, **kw)
