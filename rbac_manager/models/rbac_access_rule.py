from odoo import api, fields, models, _
from odoo.exceptions import AccessError


MODEL_ACCESS_KEYS = (
    'restrict_create',
    'restrict_edit',
    'restrict_delete',
    'restrict_archive',
    'restrict_duplicate',
    'restrict_import',
    'restrict_export',
    'readonly',
)


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
        # Access Studio rules can change menus, model metadata, fields_get, and
        # postprocessed views. A partial cache clear leaves stale readonly /
        # invisible modifiers around until module upgrade.
        self.env.registry.clear_all_caches()

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
            'model_rules': {},
            'field_rules': {},
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
            for access_model_name, model_rule in rule._extract_model_rules(config.get('models')).items():
                restrictions['model_names'].add(access_model_name)
                current = restrictions['model_rules'].setdefault(
                    access_model_name, {key: False for key in MODEL_ACCESS_KEYS}
                )
                for key in MODEL_ACCESS_KEYS:
                    current[key] = current[key] or bool(model_rule.get(key))
            for field_model, fields in rule._extract_field_rules(config.get('fields')).items():
                model_fields = restrictions['field_rules'].setdefault(field_model, {})
                for field_name, field_rule in fields.items():
                    current = model_fields.setdefault(field_name, {
                        'invisible': False,
                        'readonly': False,
                        'required': False,
                        'external_link': False,
                    })
                    for key in current:
                        current[key] = current[key] or bool(field_rule.get(key))
            for key in (
                'force_readonly', 'hide_import', 'hide_export', 'hide_spreadsheet',
                'hide_add_property', 'disable_dev_mode', 'hide_technical_settings',
                'hide_chatter', 'hide_send_message', 'hide_log_note', 'hide_activity',
            ):
                restrictions[key] = restrictions[key] or bool(config.get(key))
        if model_name and model_name not in restrictions['model_names']:
            restrictions['model_selected'] = False
            restrictions['model_rule'] = {key: False for key in MODEL_ACCESS_KEYS}
        else:
            restrictions['model_selected'] = bool(model_name and model_name in restrictions['model_names'])
            restrictions['model_rule'] = restrictions['model_rules'].get(
                model_name, {key: False for key in MODEL_ACCESS_KEYS}
            )
        restrictions['field_rule'] = restrictions['field_rules'].get(model_name, {}) if model_name else {}
        return restrictions

    @api.model
    def is_operation_blocked(self, model_name, operation, user=None, company=None):
        if self.env.su or self.env.context.get('rbac_access_bypass'):
            return False
        restrictions = self.get_access_restrictions(
            model_name=model_name,
            user=user or self.env.user,
            company=company or self.env.company,
        )
        model_rule = restrictions.get('model_rule') or {}
        if restrictions.get('force_readonly') and operation != 'read':
            return True
        if operation == 'import' and restrictions.get('hide_import'):
            return True
        if operation == 'export' and restrictions.get('hide_export'):
            return True
        if model_rule.get('readonly') and operation in ('create', 'write', 'unlink', 'archive', 'duplicate', 'import'):
            return True
        operation_map = {
            'create': 'restrict_create',
            'write': 'restrict_edit',
            'unlink': 'restrict_delete',
            'archive': 'restrict_archive',
            'duplicate': 'restrict_duplicate',
            'import': 'restrict_import',
            'export': 'restrict_export',
        }
        key = operation_map.get(operation)
        return bool(key and model_rule.get(key))

    @api.model
    def raise_operation_blocked(self, model_name, operation):
        operation_label = {
            'create': _('create'),
            'write': _('edit'),
            'unlink': _('delete'),
            'archive': _('archive/unarchive'),
            'duplicate': _('duplicate'),
            'import': _('import'),
            'export': _('export'),
        }.get(operation, operation)
        model_label = self.env['ir.model'].sudo()._get(model_name).name or model_name
        raise AccessError(_(
            "Access Studio rule blocks %(operation)s on %(model)s.",
            operation=operation_label,
            model=model_label,
        ))

    def _applies_to_user(self, user, company):
        self.ensure_one()
        audience = self.audience_json or {}

        role_items = audience.get('roles') or []
        dept_items = audience.get('depts') or []

        user_ids = self._extract_ids(audience.get('users'))
        excluded_user_ids = self._extract_ids(audience.get('exclude'))
        role_ids = self._extract_ids(role_items)
        role_names = self._extract_names(role_items)
        department_ids = self._extract_ids(dept_items)
        department_names = self._extract_names(dept_items)
        company_ids = self._extract_ids(audience.get('companies'))

        if user.id in excluded_user_ids:
            return False

        has_role_audience = bool(role_items)
        explicit_audience = bool(user_ids or has_role_audience or department_ids or department_names or company_ids)
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

        if has_role_audience:
            user_roles = user.with_context(active_test=False).role_user_ids
            user_role_ids = set(user_roles.ids)
            user_role_names = set(user_roles.mapped('name'))
            if role_ids and user_role_ids.intersection(role_ids):
                return True
            if role_names and user_role_names.intersection(role_names):
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
        return set(self._extract_model_rules(items))

    @api.model
    def _extract_model_rules(self, items):
        rules = {}
        ir_models = {}
        unresolved_ids = []
        for item in items or []:
            if isinstance(item, dict) and item.get('id') and not item.get('model'):
                unresolved_ids.append(item.get('id'))
            elif item and not isinstance(item, dict):
                unresolved_ids.append(item)
        model_ids = [int(model_id) for model_id in unresolved_ids if str(model_id).isdigit()]
        if model_ids:
            ir_models = {
                model.id: model.model
                for model in self.env['ir.model'].sudo().browse(model_ids).exists()
            }
        for item in items or []:
            if isinstance(item, dict):
                item_id = item.get('id')
                try:
                    item_id = int(item_id) if item_id else False
                except (TypeError, ValueError):
                    item_id = False
                model_name = item.get('model') or ir_models.get(item_id)
                if not model_name:
                    continue
                has_operation_keys = any(key in item for key in MODEL_ACCESS_KEYS)
                model_rule = rules.setdefault(model_name, {key: False for key in MODEL_ACCESS_KEYS})
                if not has_operation_keys:
                    for key in MODEL_ACCESS_KEYS:
                        model_rule[key] = True
                    continue
                for key in MODEL_ACCESS_KEYS:
                    model_rule[key] = model_rule[key] or bool(item.get(key))
            elif item:
                try:
                    item_id = int(item)
                except (TypeError, ValueError):
                    item_id = False
                model_name = ir_models.get(item_id)
                if model_name:
                    rules[model_name] = {key: True for key in MODEL_ACCESS_KEYS}
        return rules

    @api.model
    def _extract_model_names_legacy(self, items):
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

    @api.model
    def _extract_field_rules(self, items):
        rules = {}
        for item in items or []:
            if not isinstance(item, dict):
                continue
            model_name = item.get('model')
            if not model_name and item.get('model_id'):
                try:
                    model_name = self.env['ir.model'].sudo().browse(int(item['model_id'])).exists().model
                except (TypeError, ValueError):
                    model_name = False
            if not model_name:
                continue
            model_rules = rules.setdefault(model_name, {})
            flags = {
                'invisible': bool(item.get('invisible')),
                'readonly': bool(item.get('readonly')),
                'required': bool(item.get('required')),
                'external_link': bool(item.get('external_link')),
            }
            for field in item.get('fields') or []:
                if not isinstance(field, dict):
                    continue
                field_name = field.get('field_name') or field.get('name')
                if not field_name and field.get('id'):
                    try:
                        field_name = self.env['ir.model.fields'].sudo().browse(int(field['id'])).exists().name
                    except (TypeError, ValueError):
                        field_name = False
                if field_name:
                    model_rules[field_name] = dict(flags)
        return rules
