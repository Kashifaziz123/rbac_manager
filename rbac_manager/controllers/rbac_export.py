import json
import logging

from werkzeug.exceptions import InternalServerError

from odoo import http
from odoo.addons.web.controllers.export import CSVExport, ExcelExport
from odoo.http import request


_logger = logging.getLogger(__name__)


class RbacExportMixin:

    def _rbac_check_export(self, data):
        params = json.loads(data)
        model = params.get('model')
        if model and request.env['rbac.access.rule'].is_operation_blocked(model, 'export'):
            request.env['rbac.access.rule'].raise_operation_blocked(model, 'export')


class RbacCSVExport(RbacExportMixin, CSVExport):

    @http.route('/web/export/csv', type='http', auth='user')
    def web_export_csv(self, data):
        try:
            self._rbac_check_export(data)
            return self.base(data)
        except Exception as exc:
            _logger.exception("Exception during request handling.")
            payload = json.dumps({
                'code': 0,
                'message': "Odoo Server Error",
                'data': http.serialize_exception(exc),
            })
            raise InternalServerError(payload) from exc


class RbacExcelExport(RbacExportMixin, ExcelExport):

    @http.route('/web/export/xlsx', type='http', auth='user')
    def web_export_xlsx(self, data):
        try:
            self._rbac_check_export(data)
            return self.base(data)
        except Exception as exc:
            _logger.exception("Exception during request handling.")
            payload = json.dumps({
                'code': 0,
                'message': "Odoo Server Error",
                'data': http.serialize_exception(exc),
            })
            raise InternalServerError(payload) from exc
