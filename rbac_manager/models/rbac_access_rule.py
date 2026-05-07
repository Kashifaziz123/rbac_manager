from odoo import api, fields, models, _
from odoo.exceptions import AccessError
import json


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
        if not self.env.context.get('rbac_access_rule_audit_skip'):
            for record, vals in zip(records, vals_list):
                record._audit_access_rule_change('Access Rule Created', {}, vals)
        return records

    def write(self, vals):
        audit_snapshots = {}
        if not self.env.context.get('rbac_access_rule_audit_skip'):
            audit_snapshots = {record.id: record._audit_access_rule_snapshot() for record in self}
        result = super().write(vals)
        self._clear_rbac_rule_caches()
        if audit_snapshots:
            for record in self:
                record._audit_access_rule_change(
                    'Access Rule Status Changed' if set(vals) == {'active'} else 'Access Rule Updated',
                    audit_snapshots.get(record.id, {}),
                    vals,
                )
        return result

    def unlink(self):
        audit_snapshots = []
        if not self.env.context.get('rbac_access_rule_audit_skip'):
            audit_snapshots = [
                (record.name or _('Access Rule'), record._audit_access_rule_snapshot())
                for record in self
            ]
        for rule_name, snapshot in audit_snapshots:
            self._audit_access_rule_change('Access Rule Deleted', snapshot, {}, rule_name=rule_name)
        result = super().unlink()
        self._clear_rbac_rule_caches()
        return result

    def _clear_rbac_rule_caches(self):
        # Access Studio rules can change menus, model metadata, fields_get, and
        # postprocessed views. A partial cache clear leaves stale readonly /
        # invisible modifiers around until module upgrade.
        self.env.registry.clear_all_caches()

    def _audit_access_rule_snapshot(self):
        self.ensure_one()
        return {
            'name': self.name,
            'description': self.description,
            'rule_type': self.rule_type,
            'priority': self.priority,
            'active': self.active,
            'risk': self.risk,
            'sequence': self.sequence,
            'audience_json': self.audience_json or {},
            'impact_json': self.impact_json or [],
            'config_json': self.config_json or {},
        }

    @api.model
    def _audit_access_rule_json(self, value):
        try:
            return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
        except TypeError:
            return str(value)

    def _audit_access_rule_change(self, method, old_values, new_values, rule_name=None):
        name = rule_name or (self.name if len(self) == 1 else False) or new_values.get('name') or _('Access Rule')
        audit = self.env['rbac.audit'].sudo().create_log(
            self.env.user,
            '%s -> %s' % (method, name),
        )
        model = self.env['ir.model'].sudo()._get('rbac.access.rule')
        if not model:
            return audit
        field_names = set(old_values) | set(new_values)
        fields_by_name = {
            field.name: field
            for field in self.env['ir.model.fields'].sudo().search([
                ('model_id', '=', model.id),
                ('name', 'in', list(field_names)),
            ])
        }
        for field_name in sorted(field_names):
            field = fields_by_name.get(field_name)
            if not field:
                continue
            old_value = old_values.get(field_name)
            new_value = new_values.get(field_name)
            if old_value == new_value:
                continue
            self.env['rbac.audit.line'].sudo().create({
                'rbac_audit_id': audit.id,
                'field_id': field.id,
                'old_value': self._audit_access_rule_json(old_value),
                'new_value': self._audit_access_rule_json(new_value),
            })
        return audit

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
            'domain_rules': {},
            'button_rules': {},
            'filter_rules': {},
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
            for domain_model, domain_rules in rule._extract_domain_rules(config.get('domain_access')).items():
                restrictions['domain_rules'].setdefault(domain_model, []).extend(domain_rules)
            for button_model, button_nodes in rule._extract_button_rules(config.get('button_tab_access')).items():
                restrictions['button_rules'].setdefault(button_model, []).extend(button_nodes)
            for filter_model, filter_nodes in rule._extract_filter_rules(config.get('filter_group_access')).items():
                restrictions['filter_rules'].setdefault(filter_model, []).extend(filter_nodes)
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
        restrictions['domain_rule'] = restrictions['domain_rules'].get(model_name, []) if model_name else []
        restrictions['button_rule'] = restrictions['button_rules'].get(model_name, []) if model_name else []
        restrictions['filter_rule'] = restrictions['filter_rules'].get(model_name, []) if model_name else []
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
        domain_rules = restrictions.get('domain_rule') or []
        if domain_rules and operation == 'create':
            return not any(rule.get('create_right') for rule in domain_rules)
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

    @api.model
    def raise_button_blocked(self, model_name, method_name):
        model_label = self.env['ir.model'].sudo()._get(model_name).name or model_name
        raise AccessError(_(
            "Access Studio rule blocks button action %(method)s on %(model)s.",
            method=method_name,
            model=model_label,
        ))

    @api.model
    def is_button_method_blocked(self, model_name, method_name, user=None, company=None):
        if self.env.su or self.env.context.get('rbac_access_bypass') or not model_name or not method_name:
            return False
        restrictions = self.get_access_restrictions(
            model_name=model_name,
            user=user or self.env.user,
            company=company or self.env.company,
        )
        for rule in restrictions.get('button_rule') or []:
            if rule.get('node_type') == 'button' and rule.get('button_type') == 'object' and rule.get('attribute_name') == method_name:
                return True
        return False

    @api.model
    def is_action_blocked(self, action_id, user=None, company=None):
        if self.env.su or self.env.context.get('rbac_access_bypass') or not action_id:
            return False
        restrictions = self.get_access_restrictions(
            user=user or self.env.user,
            company=company or self.env.company,
        )
        hidden_menu_ids = restrictions.get('hide_menu_ids') or set()
        if hidden_menu_ids:
            menus = self.env['ir.ui.menu'].sudo().browse(list(hidden_menu_ids)).exists()
            for menu in menus:
                action = menu.action
                if not action:
                    continue
                if action.id == action_id:
                    return True
                try:
                    base_action = action.sudo().mapped('action_id') if action._name == 'ir.actions.actions' else action
                    if base_action and base_action.id == action_id:
                        return True
                except Exception:
                    continue
        for rule in restrictions.get('rules') or self.browse():
            for _model_name, button_nodes in rule._extract_button_rules((rule.config_json or {}).get('button_tab_access')).items():
                for node in button_nodes:
                    if node.get('node_type') != 'button' or node.get('button_type') != 'action':
                        continue
                    attr_name = str(node.get('attribute_name') or '')
                    if attr_name == str(action_id):
                        return True
        return False

    @api.model
    def raise_action_blocked(self, action_id):
        action = self.env['ir.actions.actions'].sudo().browse(action_id).exists()
        action_name = action.name if action else action_id
        raise AccessError(_("Access Studio rule blocks opening action %(action)s.", action=action_name))

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
            if not company or company.id not in company_ids:
                return False
            if not (user_ids or has_role_audience or department_ids or department_names):
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

    @api.model
    def _extract_domain_rules(self, items):
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
            if not isinstance(item, dict):
                continue
            item_id = item.get('model_id') or item.get('id')
            try:
                item_id = int(item_id) if item_id else False
            except (TypeError, ValueError):
                item_id = False
            model_name = item.get('model') or ir_models.get(item_id)
            if not model_name:
                continue
            rules.setdefault(model_name, []).append({
                'model': model_name,
                'model_id': item_id,
                'name': item.get('name') or model_name,
                'read_right': item.get('read_right') is not False,
                'create_right': bool(item.get('create_right')),
                'write_right': bool(item.get('write_right')),
                'delete_right': bool(item.get('delete_right')),
                'apply_domain': bool(item.get('apply_domain')),
                'domain': item.get('domain') or '[]',
                'rule_name': self.name,
            })
        return rules

    @api.model
    def _extract_button_rules(self, items):
        rules = {}
        ir_models = {}
        unresolved_ids = []
        for item in items or []:
            if isinstance(item, dict) and item.get('id') and not item.get('model'):
                unresolved_ids.append(item.get('id'))
        model_ids = [int(model_id) for model_id in unresolved_ids if str(model_id).isdigit()]
        if model_ids:
            ir_models = {
                model.id: model.model
                for model in self.env['ir.model'].sudo().browse(model_ids).exists()
            }
        for item in items or []:
            if not isinstance(item, dict):
                continue
            item_id = item.get('model_id') or item.get('id')
            try:
                item_id = int(item_id) if item_id else False
            except (TypeError, ValueError):
                item_id = False
            model_name = item.get('model') or ir_models.get(item_id)
            if not model_name:
                continue
            for node in item.get('nodes') or []:
                if not isinstance(node, dict) or not node.get('node_type'):
                    continue
                rules.setdefault(model_name, []).append({
                    'node_type': node.get('node_type'),
                    'name': node.get('name') or node.get('attribute_string') or '',
                    'attribute_name': node.get('attribute_name') or '',
                    'attribute_string': node.get('attribute_string') or node.get('name') or '',
                    'button_type': node.get('button_type') or '',
                    'is_smart_button': bool(node.get('is_smart_button')),
                })
        return rules

    @api.model
    def _extract_filter_rules(self, items):
        rules = {}
        ir_models = {}
        unresolved_ids = []
        for item in items or []:
            if isinstance(item, dict) and item.get('id') and not item.get('model'):
                unresolved_ids.append(item.get('id'))
        model_ids = [int(model_id) for model_id in unresolved_ids if str(model_id).isdigit()]
        if model_ids:
            ir_models = {
                model.id: model.model
                for model in self.env['ir.model'].sudo().browse(model_ids).exists()
            }
        for item in items or []:
            if not isinstance(item, dict):
                continue
            item_id = item.get('model_id') or item.get('id')
            try:
                item_id = int(item_id) if item_id else False
            except (TypeError, ValueError):
                item_id = False
            model_name = item.get('model') or ir_models.get(item_id)
            if not model_name:
                continue
            for node in item.get('nodes') or []:
                if not isinstance(node, dict) or node.get('node_type') not in ('filter', 'group'):
                    continue
                rules.setdefault(model_name, []).append({
                    'node_type': node.get('node_type'),
                    'name': node.get('name') or node.get('attribute_string') or '',
                    'attribute_name': node.get('attribute_name') or '',
                    'attribute_string': node.get('attribute_string') or node.get('name') or '',
                    'field_name': node.get('field_name') or self._resolve_filter_rule_field(model_name, node),
                })
        return rules

    @api.model
    def _resolve_filter_rule_field(self, model_name, node):
        attr_name = node.get('attribute_name') or ''
        node_type = node.get('node_type')
        if model_name not in self.env:
            return attr_name
        if attr_name in self.env[model_name]._fields:
            return attr_name
        Model = self.env[model_name].sudo().with_context(rbac_access_bypass=True)
        views = self.env['ir.ui.view'].sudo().search([
            ('model', '=', model_name),
            ('type', '=', 'search'),
        ])
        helper = self.env['rbac.model'].sudo()
        for view in views:
            try:
                arch, _view = Model._get_view(view_id=view.id, view_type='search')
            except Exception:
                continue
            for filter_node in arch.xpath(".//filter[@name=$name]", name=attr_name):
                is_group = helper._access_studio_filter_is_groupby(filter_node)
                if (node_type == 'group' and not is_group) or (node_type == 'filter' and is_group):
                    continue
                field_name = helper._access_studio_search_node_field_name(filter_node)
                if field_name:
                    return field_name
        return attr_name
