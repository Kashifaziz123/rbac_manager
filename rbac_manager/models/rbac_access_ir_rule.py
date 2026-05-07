import logging

from odoo import api, models
from odoo.fields import Domain
from odoo.tools.safe_eval import safe_eval


_logger = logging.getLogger(__name__)


class IrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _compute_domain(self, model_name: str, mode: str = "read") -> Domain:
        domain = super()._compute_domain(model_name, mode=mode)
        if self.env.su or self.env.context.get('rbac_access_bypass'):
            return domain
        if mode not in ('read', 'write', 'unlink'):
            return domain

        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=model_name,
            user=self.env.user,
            company=self.env.company,
        )
        domain_rules = restrictions.get('domain_rule') or []
        if not domain_rules:
            return domain

        right_key = {
            'read': 'read_right',
            'write': 'write_right',
            'unlink': 'delete_right',
        }[mode]
        allowed_domains = []
        eval_context = self._rbac_domain_eval_context()
        for rule in domain_rules:
            if not rule.get(right_key):
                continue
            if not rule.get('apply_domain'):
                allowed_domains.append(Domain.TRUE)
                continue
            try:
                allowed_domains.append(Domain(safe_eval(rule.get('domain') or '[]', eval_context)))
            except Exception:
                _logger.exception("Invalid RBAC domain rule on model %s: %s", model_name, rule.get('domain'))
                allowed_domains.append(Domain.FALSE)

        rbac_domain = Domain.OR(allowed_domains) if allowed_domains else Domain.FALSE
        return Domain.AND([domain, rbac_domain]).optimize(self.env[model_name])

    @api.model
    def _rbac_domain_eval_context(self):
        eval_context = dict(self._eval_context())
        eval_context.update({
            'true': True,
            'false': False,
            'null': None,
        })
        return eval_context
