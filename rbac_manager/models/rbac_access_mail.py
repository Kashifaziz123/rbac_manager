from odoo import api, models, _
from odoo.exceptions import AccessError


class MailThread(models.AbstractModel):
    _inherit = 'mail.thread'

    def message_post(self, *, subtype_xmlid=None, subtype_id=False, **kwargs):
        if self._rbac_chatter_message_blocked(subtype_xmlid=subtype_xmlid, subtype_id=subtype_id):
            self._rbac_raise_chatter_access_error(subtype_xmlid=subtype_xmlid, subtype_id=subtype_id)
        return super().message_post(subtype_xmlid=subtype_xmlid, subtype_id=subtype_id, **kwargs)

    def _rbac_chatter_message_blocked(self, subtype_xmlid=None, subtype_id=False):
        if self.env.su or self.env.context.get('rbac_access_bypass'):
            return False
        if self.env.context.get('rbac_internal_post'):
            return False
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        if not (restrictions.get('hide_send_message') or restrictions.get('hide_log_note')):
            return False
        subtype = subtype_xmlid
        if not subtype and subtype_id:
            subtype_rec = self.env['mail.message.subtype'].sudo().browse(subtype_id).exists()
            subtype = subtype_rec.get_external_id().get(subtype_rec.id) if subtype_rec else False
        if subtype == 'mail.mt_note':
            return bool(restrictions.get('hide_log_note'))
        if subtype == 'mail.mt_comment':
            return bool(restrictions.get('hide_send_message'))
        return False

    def _rbac_raise_chatter_access_error(self, subtype_xmlid=None, subtype_id=False):
        if subtype_xmlid == 'mail.mt_note':
            raise AccessError(_("RBAC Access Studio blocks logging notes on this document."))
        raise AccessError(_("RBAC Access Studio blocks sending messages on this document."))


class MailActivityMixin(models.AbstractModel):
    _inherit = 'mail.activity.mixin'

    def activity_schedule(self, act_type_xmlid='', date_deadline=None, summary='', note='', **act_values):
        if self._rbac_activity_blocked():
            raise AccessError(_("RBAC Access Studio blocks scheduling activities on this document."))
        return super().activity_schedule(
            act_type_xmlid=act_type_xmlid,
            date_deadline=date_deadline,
            summary=summary,
            note=note,
            **act_values
        )

    def _rbac_activity_blocked(self):
        if self.env.su or self.env.context.get('rbac_access_bypass'):
            return False
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        return bool(restrictions.get('hide_activity'))


class MailActivity(models.Model):
    _inherit = 'mail.activity'

    @api.model_create_multi
    def create(self, vals_list):
        if not (self.env.su or self.env.context.get('rbac_access_bypass')):
            blocked_models = set()
            for vals in vals_list:
                res_model = vals.get('res_model')
                if not res_model and vals.get('res_model_id'):
                    model = self.env['ir.model'].sudo().browse(vals['res_model_id']).exists()
                    res_model = model.model if model else False
                if res_model in blocked_models:
                    continue
                restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
                    model_name=res_model,
                    user=self.env.user,
                    company=self.env.company,
                )
                if restrictions.get('hide_activity'):
                    blocked_models.add(res_model)
            if blocked_models:
                raise AccessError(_("RBAC Access Studio blocks scheduling activities on this document."))
        return super().create(vals_list)


class MailActivitySchedule(models.TransientModel):
    _inherit = 'mail.activity.schedule'

    def _action_schedule_activities(self):
        records = self._get_applied_on_records() if self.res_model else self.env['mail.activity']
        if records and records._rbac_activity_blocked():
            raise AccessError(_("RBAC Access Studio blocks scheduling activities on this document."))
        return super()._action_schedule_activities()
