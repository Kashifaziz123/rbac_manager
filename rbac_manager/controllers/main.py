# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request, content_disposition
import io
import csv
from datetime import datetime
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet


class RBACAuditExportController(http.Controller):
    """
    Export RBAC Audit Logs (CSV / PDF)
    Dynamically extracts `action` from the `method` field, e.g. "Add Role -> X" => "Add Role".
    """

    @http.route('/rbac/audit/export', type='http', auth='user')
    def export_audit_logs(self, **kwargs):
        export_format = (kwargs.get('format') or 'csv').lower()
        user_id = kwargs.get('user_id')
        admin_id = kwargs.get('admin_id')
        date_from = kwargs.get('from')
        date_to = kwargs.get('to')
        search = kwargs.get('search', '')

        logs = request.env['rbac.model'].sudo().get_filtered_audit_logs({
            'user_id': user_id,
            'admin_id': admin_id,
            'from': date_from,
            'to': date_to,
            'search': search,
        })

        # ✅ inject derived 'action' into each record (computed from method)
        for l in logs:
            method_text = (l.get('method') or '').strip()
            if '->' in method_text:
                l['action'] = method_text.split('->')[0].strip()
            elif method_text:
                l['action'] = method_text
            else:
                l['action'] = 'Unknown'

        if not logs:
            return request.make_response(
                "No audit logs found for the selected filters.",
                headers=[('Content-Type', 'text/plain; charset=utf-8')]
            )

        if export_format == 'pdf':
            return self._generate_pdf(logs)
        return self._generate_csv(logs)

    # ------------------------------------------------------
    # 📦 CSV Export
    # ------------------------------------------------------
    def _generate_csv(self, logs):
        buffer = io.StringIO()
        writer = csv.writer(buffer)

        writer.writerow([
            "Timestamp",
            "Performed By",
            "Performed Email",
            "Target User",
            "Target Email",
            "Action",
            "Details",
            "IP Address"
        ])

        for l in logs:
            writer.writerow([
                f"{l['create_date'][0]} {l['create_date'][1]}",
                l['create_uid'][0],
                l['create_uid'][1],
                l['user_uid'][0],
                l['user_uid'][1],
                l.get('action', 'Unknown'),
                l.get('method', ''),
                l['ip_address']
            ])

        filename = f"permission_audit_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        response = request.make_response(
            buffer.getvalue(),
            headers=[
                ('Content-Type', 'text/csv; charset=utf-8'),
                ('Content-Disposition', content_disposition(filename)),
            ],
        )
        buffer.close()
        return response

    # ------------------------------------------------------
    # 🧾 PDF Export
    # ------------------------------------------------------
    def _generate_pdf(self, logs):
        buffer = io.BytesIO()
        filename = f"permission_audit_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"

        doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), leftMargin=25, rightMargin=25)
        styles = getSampleStyleSheet()
        elements = []

        # Title
        elements.append(Paragraph("Permission Audit Log", styles["Title"]))
        elements.append(Spacer(1, 10))

        # Prepare table data with Action column included
        data = [[
            "Timestamp",
            "Performed By",
            "Performed Email",
            "Target User",
            "Target Email",
            "Action",
            "Details",
            "IP Address"
        ]]

        for l in logs:
            data.append([
                f"{l['create_date'][0]} {l['create_date'][1]}",
                l['create_uid'][0],
                l['create_uid'][1],
                l['user_uid'][0],
                l['user_uid'][1],
                l.get('action', 'Unknown'),
                l.get('method', ''),
                l['ip_address'],
            ])

        table = Table(data, repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3B82F6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
            ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
        ]))

        elements.append(table)
        doc.build(elements)

        response = request.make_response(
            buffer.getvalue(),
            headers=[
                ('Content-Type', 'application/pdf'),
                ('Content-Disposition', content_disposition(filename))
            ],
        )
        buffer.close()
        return response