# -*- coding: utf-8 -*-
from odoo import models


class ResPartner(models.Model):
    _inherit = 'res.partner'

    def write(self, vals):
        # When creating a role-template user (an inactive res.users record used as a
        # permissions blueprint), Odoo's base res_users.create() syncs the partner's
        # active flag: ``user.partner_id.active = user.active``.  This triggers
        # res.partner's archive check (res_partner.py:843-860), which raises if ANY
        # res.users record is linked to the partner — even the freshly-created inactive
        # role-template user.  We bypass that check by writing 'active' separately via
        # direct SQL when the ``creating_role_template`` context flag is present.
        if self.env.context.get('creating_role_template') and vals.get('active') is False:
            non_active_vals = {k: v for k, v in vals.items() if k != 'active'}
            if non_active_vals:
                super().write(non_active_vals)
            if self.ids:
                self.env.cr.execute(
                    'UPDATE res_partner SET active = false WHERE id = ANY(%s)',
                    (list(self.ids),),
                )
                self.invalidate_recordset(['active'])
            return True
        return super().write(vals)
