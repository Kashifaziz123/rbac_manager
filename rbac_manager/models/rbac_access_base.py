import ast
import copy

from odoo import api, models
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.tools.safe_eval import safe_eval


class Base(models.AbstractModel):
    _inherit = 'base'

    @api.model
    def _get_view_cache_key(self, view_id=None, view_type='form', **options):
        key = super()._get_view_cache_key(view_id=view_id, view_type=view_type, **options)
        return key + (self._rbac_view_cache_signature(),)

    @api.model
    def _rbac_view_cache_signature(self):
        if self.env.su or self.env.context.get('rbac_access_bypass'):
            return False
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        model_rule = restrictions.get('model_rule') or {}
        field_rule = restrictions.get('field_rule') or {}
        button_rule = restrictions.get('button_rule') or []
        filter_rule = restrictions.get('filter_rule') or []
        relevant = (
            restrictions.get('model_selected') or restrictions.get('force_readonly') or
            restrictions.get('hide_import') or restrictions.get('hide_export') or
            restrictions.get('hide_spreadsheet') or restrictions.get('hide_add_property') or
            restrictions.get('hide_chatter') or bool(field_rule) or bool(button_rule) or bool(filter_rule)
        )
        if not relevant:
            return False
        field_signature = tuple(
            sorted(
                (
                    field_name,
                    bool(rule.get('invisible')),
                    bool(rule.get('readonly')),
                    bool(rule.get('required')),
                    bool(rule.get('external_link')),
                )
                for field_name, rule in field_rule.items()
            )
        )
        model_signature = tuple(sorted((key, bool(value)) for key, value in model_rule.items()))
        button_signature = tuple(
            sorted(
                (
                    rule.get('node_type') or '',
                    rule.get('attribute_name') or '',
                    rule.get('attribute_string') or '',
                    rule.get('button_type') or '',
                )
                for rule in button_rule
            )
        )
        filter_signature = tuple(
            sorted(
                (
                    rule.get('node_type') or '',
                    rule.get('attribute_name') or '',
                    rule.get('attribute_string') or '',
                )
                for rule in filter_rule
            )
        )
        return (
            self.env.user.id,
            self.env.company.id,
            bool(restrictions.get('force_readonly')),
            bool(restrictions.get('hide_import')),
            bool(restrictions.get('hide_export')),
            bool(restrictions.get('hide_spreadsheet')),
            bool(restrictions.get('hide_add_property')),
            bool(restrictions.get('hide_chatter')),
            model_signature,
            field_signature,
            button_signature,
            filter_signature,
        )

    @api.model
    def _get_view(self, view_id=None, view_type='form', **options):
        arch, view = super()._get_view(view_id=view_id, view_type=view_type, **options)
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        model_selected = restrictions.get('model_selected')
        model_rule = restrictions.get('model_rule') or {}
        field_rule = restrictions.get('field_rule') or {}
        button_rule = restrictions.get('button_rule') or []
        filter_rule = restrictions.get('filter_rule') or []
        readonly = restrictions.get('force_readonly') or model_rule.get('readonly')
        needs_change = (
            readonly or model_selected or restrictions.get('hide_import') or
            restrictions.get('hide_export') or restrictions.get('hide_add_property') or
            restrictions.get('hide_chatter') or
            bool(field_rule) or bool(button_rule) or bool(filter_rule)
        )
        if needs_change:
            arch = copy.deepcopy(arch)

        if readonly and view_type in ('form', 'list', 'tree', 'kanban'):
            arch.set('create', 'false')
            arch.set('edit', 'false')
            arch.set('delete', 'false')
            arch.set('duplicate', 'false')

        if model_selected and view_type in ('form', 'list', 'tree', 'kanban'):
            if model_rule.get('restrict_create'):
                arch.set('create', 'false')
            if model_rule.get('restrict_edit'):
                arch.set('edit', 'false')
            if model_rule.get('restrict_delete'):
                arch.set('delete', 'false')
            if model_rule.get('restrict_duplicate'):
                arch.set('duplicate', 'false')

        if view_type in ('list', 'tree', 'kanban'):
            if readonly or restrictions.get('hide_import') or model_rule.get('restrict_import'):
                arch.set('import', 'false')
            if restrictions.get('hide_export') or model_rule.get('restrict_export'):
                arch.set('export_xlsx', 'false')

        if view_type == 'form' and restrictions.get('hide_chatter'):
            self._rbac_hide_chatter_nodes(arch)

        if restrictions.get('hide_add_property'):
            self._rbac_hide_property_definition_fields(arch)

        if field_rule:
            self._rbac_apply_field_rules(arch, field_rule)

        if button_rule:
            self._rbac_apply_button_rules(arch, button_rule)

        if filter_rule and view_type == 'search':
            self._rbac_apply_filter_rules(arch, filter_rule)

        return arch, view

    @api.model
    def fields_get(self, allfields=None, attributes=None):
        result = super().fields_get(allfields=allfields, attributes=attributes)
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        model_rule = restrictions.get('model_rule') or {}
        if model_rule.get('restrict_archive') or model_rule.get('readonly') or restrictions.get('force_readonly'):
            for field_name in ('active', 'x_active'):
                if field_name in result:
                    result[field_name] = dict(result[field_name], readonly=True)
        field_rule = restrictions.get('field_rule') or {}
        for field_name, rule in field_rule.items():
            if field_name not in result:
                continue
            updates = {}
            if rule.get('readonly'):
                updates['readonly'] = True
            if rule.get('required'):
                updates['required'] = True
            if updates:
                result[field_name] = dict(result[field_name], **updates)
        return result

    @api.model_create_multi
    def create(self, vals_list):
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, 'create'):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, 'create')
        for vals in vals_list:
            self._rbac_check_protected_field_write(vals)
        if any(self._rbac_has_property_definition_change(vals) for vals in vals_list):
            raise AccessError("Adding or changing property fields is restricted by RBAC Access Studio.")
        return super().create(vals_list)

    def write(self, vals):
        if self._rbac_has_property_definition_change(vals):
            raise AccessError("Adding or changing property fields is restricted by RBAC Access Studio.")
        if self._rbac_domain_operation_blocked('write'):
            self._rbac_raise_domain_access_error('write')
        self._rbac_check_protected_field_write(vals)
        operation = 'archive' if self._rbac_is_archive_write(vals) else 'write'
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, operation):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, operation)
        return super().write(vals)

    def unlink(self):
        if self._rbac_domain_operation_blocked('unlink'):
            self._rbac_raise_domain_access_error('unlink')
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, 'unlink'):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, 'unlink')
        return super().unlink()

    def copy(self, default=None):
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, 'duplicate'):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, 'duplicate')
        return super().copy(default=default)

    @api.model
    def load(self, fields, data):
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, 'import'):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, 'import')
        return super().load(fields, data)

    def export_data(self, fields_to_export):
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, 'export'):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, 'export')
        return super().export_data(fields_to_export)

    def action_archive(self):
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, 'archive'):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, 'archive')
        return super().action_archive()

    def action_unarchive(self):
        if self.env['rbac.access.rule'].is_operation_blocked(self._name, 'archive'):
            self.env['rbac.access.rule'].raise_operation_blocked(self._name, 'archive')
        return super().action_unarchive()

    def _rbac_is_archive_write(self, vals):
        return (
            isinstance(vals, dict) and
            set(vals).issubset({'active'}) and
            'active' in vals and
            'active' in self._fields
        )

    @api.model
    def _rbac_check_protected_field_write(self, vals):
        if self.env.su or self.env.context.get('rbac_access_bypass') or not vals:
            return
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        field_rule = restrictions.get('field_rule') or {}
        blocked = []
        for field_name in vals:
            rule = field_rule.get(field_name)
            if rule and (rule.get('readonly') or rule.get('invisible')):
                blocked.append(field_name)
        if blocked:
            labels = []
            fields_meta = self.fields_get(blocked, attributes=['string'])
            for field_name in blocked:
                labels.append(fields_meta.get(field_name, {}).get('string') or field_name)
            raise AccessError(
                "Access Studio field rule blocks changing: %s." % ', '.join(sorted(labels))
            )

    @api.model
    def _rbac_hide_chatter_nodes(self, arch):
        for node in arch.xpath("//div[contains(concat(' ', normalize-space(@class), ' '), ' oe_chatter ')]"):
            parent = node.getparent()
            if parent is not None:
                parent.remove(node)

    @api.model
    def _rbac_hide_property_definition_fields(self, arch):
        for field_name, field in self._fields.items():
            if getattr(field, 'type', None) != 'properties_definition':
                continue
            for node in arch.xpath(".//field[@name=$name]", name=field_name):
                node.set('readonly', 'True')
                node.set('invisible', 'True')

    @api.model
    def _rbac_apply_field_rules(self, arch, field_rule):
        for field_name, rule in field_rule.items():
            for node in arch.xpath(".//field[@name=$name]", name=field_name):
                if rule.get('invisible'):
                    node.set('invisible', 'True')
                if rule.get('readonly'):
                    node.set('readonly', 'True')
                    node.set('force_save', 'True')
                if rule.get('required'):
                    node.set('required', 'True')
                if rule.get('external_link'):
                    node.set('options', self._rbac_merge_field_options(node.get('options')))
            if rule.get('invisible'):
                for node in arch.xpath(".//label[@for=$name]", name=field_name):
                    node.set('invisible', 'True')

    @api.model
    def _rbac_apply_button_rules(self, arch, button_rules):
        for rule in button_rules:
            node_type = rule.get('node_type')
            attr_name = rule.get('attribute_name') or ''
            attr_string = rule.get('attribute_string') or ''
            button_type = rule.get('button_type') or ''
            if node_type == 'button':
                xpath = ".//button"
                if attr_name:
                    xpath += "[@name=$name]"
                    nodes = arch.xpath(xpath, name=attr_name)
                else:
                    nodes = []
                if button_type:
                    nodes = [node for node in nodes if node.get('type') == button_type]
                if attr_string:
                    nodes = [
                        node for node in nodes
                        if (node.get('string') or self._rbac_node_text(node)) == attr_string or node.get('name') == attr_name
                    ]
                self._rbac_hide_nodes(nodes)
            elif node_type == 'page':
                nodes = []
                if attr_name:
                    nodes.extend(arch.xpath(".//page[@name=$name] | .//app[@name=$name or @data-key=$name]", name=attr_name))
                if attr_string:
                    nodes.extend(arch.xpath(".//page[@string=$string] | .//app[@string=$string]", string=attr_string))
                self._rbac_hide_nodes(nodes)
            elif node_type == 'link':
                nodes = arch.xpath(".//a[@name=$name]", name=attr_name) if attr_name else []
                if button_type:
                    nodes = [node for node in nodes if node.get('type') == button_type]
                self._rbac_hide_nodes(nodes)

    @api.model
    def _rbac_apply_filter_rules(self, arch, filter_rules):
        for rule in filter_rules:
            attr_name = rule.get('attribute_name') or ''
            attr_string = rule.get('attribute_string') or ''
            node_type = rule.get('node_type')
            nodes = arch.xpath(".//filter[@name=$name]", name=attr_name) if attr_name else []
            if attr_string:
                nodes = [
                    node for node in nodes
                    if (node.get('string') or '') == attr_string or node.get('name') == attr_name
                ]
            if node_type == 'group':
                nodes = [node for node in nodes if 'group_by' in (node.get('context') or '')]
            elif node_type == 'filter':
                nodes = [node for node in nodes if 'group_by' not in (node.get('context') or '')]
            self._rbac_remove_nodes(nodes)

    @api.model
    def _rbac_hide_nodes(self, nodes):
        seen = set()
        for node in nodes:
            node_id = id(node)
            if node_id in seen:
                continue
            seen.add(node_id)
            node.set('invisible', 'True')
            node.attrib.pop('attrs', None)

    @api.model
    def _rbac_remove_nodes(self, nodes):
        seen = set()
        for node in nodes:
            node_id = id(node)
            if node_id in seen:
                continue
            seen.add(node_id)
            parent = node.getparent()
            if parent is not None:
                parent.remove(node)

    @api.model
    def _rbac_node_text(self, node):
        text = ' '.join(''.join(node.itertext()).split())
        return text

    @api.model
    def _rbac_merge_field_options(self, options):
        values = {}
        if options:
            try:
                values = ast.literal_eval(options)
            except (SyntaxError, ValueError):
                values = {}
        if not isinstance(values, dict):
            values = {}
        values.update({'no_edit': True, 'no_create': True, 'no_open': True})
        return str(values)

    def _rbac_has_property_definition_change(self, vals):
        if self.env.su or self.env.context.get('rbac_access_bypass'):
            return False
        if not isinstance(vals, dict) or not vals:
            return False
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        if not restrictions.get('hide_add_property'):
            return False
        for field_name, value in vals.items():
            field = self._fields.get(field_name)
            field_type = getattr(field, 'type', None)
            if field_type == 'properties_definition':
                return True
            if field_type != 'properties':
                continue
            values = value if isinstance(value, list) else []
            if any(
                isinstance(item, dict) and (
                    item.get('definition_changed') or item.get('definition_deleted')
                )
                for item in values
            ):
                return True
        return False

    def _rbac_domain_operation_blocked(self, operation):
        if self.env.su or self.env.context.get('rbac_access_bypass') or not self:
            return False
        right_key = {'write': 'write_right', 'unlink': 'delete_right'}.get(operation)
        if not right_key:
            return False
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            model_name=self._name,
            user=self.env.user,
            company=self.env.company,
        )
        domain_rules = restrictions.get('domain_rule') or []
        if not domain_rules:
            return False

        allowed_domains = []
        eval_context = self.env['ir.rule']._rbac_domain_eval_context()
        for rule in domain_rules:
            if not rule.get(right_key):
                continue
            if not rule.get('apply_domain'):
                return False
            try:
                allowed_domains.append(Domain(safe_eval(rule.get('domain') or '[]', eval_context)))
            except Exception:
                allowed_domains.append(Domain.FALSE)
        if not allowed_domains:
            return True
        allowed_domain = Domain.OR(allowed_domains) & Domain('id', 'in', self.ids)
        allowed_count = self.sudo().with_context(active_test=False).search_count(allowed_domain)
        return allowed_count != len(self)

    def _rbac_raise_domain_access_error(self, operation):
        label = 'edit' if operation == 'write' else 'delete'
        raise AccessError("Access Studio domain rule blocks %s on this record." % label)
