from odoo import api, fields, models


class RbacAccessRule(models.Model):
    _name = 'rbac.access.rule'
    _description = 'RBAC Access Studio Rule'
    _order = 'sequence, id desc'

    name = fields.Char(required=True)
    description = fields.Text()
    rule_type = fields.Char(default='Restriction')
    priority = fields.Char(default='Normal (50)')
    active = fields.Boolean(default=True)
    status = fields.Selection(
        [('active', 'Active'), ('draft', 'Draft')],
        compute='_compute_status',
        store=True,
    )
    risk = fields.Selection(
        [('low', 'Low'), ('medium', 'Medium'), ('high', 'High')],
        default='low',
        required=True,
    )
    sequence = fields.Integer(default=10)
    audience_json = fields.Json(default=dict)
    impact_json = fields.Json(default=list)
    config_json = fields.Json(default=dict)

    @api.depends('active')
    def _compute_status(self):
        for rule in self:
            rule.status = 'active' if rule.active else 'draft'

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._clear_rbac_rule_caches()
        return records

    def write(self, vals):
        result = super().write(vals)
        self._clear_rbac_rule_caches()
        return result

    def unlink(self):
        result = super().unlink()
        self._clear_rbac_rule_caches()
        return result

    def _clear_rbac_rule_caches(self):
        self.env.registry.clear_cache()

    @api.model
    def get_applicable_rules(self, user=None, company=None):
        user = user or self.env.user
        company = company or self.env.company
        rules = self.sudo().search([('active', '=', True)], order='sequence, id desc')
        return rules.filtered(lambda rule: rule._applies_to_user(user, company))

    @api.model
    def get_access_restrictions(self, model_name=None, user=None, company=None):
        restrictions = {
            'hide_menu_ids': set(),
            'model_names': set(),
            'force_readonly': False,
            'hide_import': False,
            'hide_export': False,
            'hide_spreadsheet': False,
            'hide_add_property': False,
            'disable_dev_mode': False,
            'hide_technical_settings': False,
            'hide_chatter': False,
            'hide_send_message': False,
            'hide_log_note': False,
            'hide_activity': False,
            'rules': self.browse(),
        }
        rules = self.get_applicable_rules(user=user, company=company)
        restrictions['rules'] = rules
        for rule in rules:
            config = rule.config_json or {}
            restrictions['hide_menu_ids'].update(rule._extract_ids(config.get('hide_menus')))
            restrictions['model_names'].update(rule._extract_model_names(config.get('models')))
            for key in (
                'force_readonly', 'hide_import', 'hide_export', 'hide_spreadsheet',
                'hide_add_property', 'disable_dev_mode', 'hide_technical_settings',
                'hide_chatter', 'hide_send_message', 'hide_log_note', 'hide_activity',
            ):
                restrictions[key] = restrictions[key] or bool(config.get(key))
        if model_name and model_name not in restrictions['model_names']:
            restrictions['model_selected'] = False
        else:
            restrictions['model_selected'] = bool(model_name and model_name in restrictions['model_names'])
        return restrictions

    def _applies_to_user(self, user, company):
        self.ensure_one()
        audience = self.audience_json or {}
        user_ids = self._extract_ids(audience.get('users'))
        excluded_user_ids = self._extract_ids(audience.get('exclude'))
        role_ids = self._extract_ids(audience.get('roles'))
        department_ids = self._extract_ids(audience.get('depts'))
        department_names = self._extract_names(audience.get('depts'))
        company_ids = self._extract_ids(audience.get('companies'))

        if user.id in excluded_user_ids:
            return False

        explicit_audience = bool(user_ids or role_ids or department_ids or department_names or company_ids)
        if not explicit_audience:
            return True

        if user.id in user_ids:
            return True

        if company_ids:
            user_company_ids = set(user.company_ids.ids)
            if company and company.id:
                user_company_ids.add(company.id)
            if user_company_ids.intersection(company_ids):
                return True

        if role_ids:
            user_role_ids = set(getattr(user, 'role_user_ids', self.env['res.users']).ids)
            if user_role_ids.intersection(role_ids):
                return True

        if department_ids or department_names:
            user_department = self._get_user_department(user)
            if user_department and (
                user_department.id in department_ids or (user_department.name or '') in department_names
            ):
                return True

        return False

    @api.model
    def _get_user_department(self, user):
        if 'hr.employee' not in self.env:
            return self.env['ir.model'].browse()
        domain = [('user_id', '=', user.id)]
        if user.email:
            domain = ['|'] + domain + [('work_email', '=', user.email)]
        employee = self.env['hr.employee'].sudo().search(
            domain,
            limit=1,
        )
        return employee.department_id if employee else self.env['hr.department'].browse()

    @api.model
    def _extract_ids(self, items):
        ids = set()
        for item in items or []:
            value = item.get('id') if isinstance(item, dict) else item
            try:
                if value:
                    ids.add(int(value))
            except (TypeError, ValueError):
                continue
        return ids

    @api.model
    def _extract_names(self, items):
        names = set()
        for item in items or []:
            if isinstance(item, dict) and item.get('name'):
                names.add(item['name'])
        return names

    @api.model
    def _extract_model_names(self, items):
        model_names = set()
        unresolved_ids = []
        for item in items or []:
            if isinstance(item, dict):
                if item.get('model'):
                    model_names.add(item['model'])
                    continue
                if item.get('id'):
                    unresolved_ids.append(item['id'])
            elif item:
                unresolved_ids.append(item)
        model_ids = [int(model_id) for model_id in unresolved_ids if str(model_id).isdigit()]
        if model_ids:
            model_names.update(
                self.env['ir.model'].sudo().browse(model_ids).exists().mapped('model')
            )
        return model_names
