from collections import defaultdict

from odoo import models, tools


class IrUiMenu(models.Model):
    _inherit = 'ir.ui.menu'

    @tools.ormcache('self.env.uid', 'debug', 'self.env.lang', 'self.env.company.id')
    def load_menus(self, debug):
        blacklisted_menu_ids = self._load_menus_blacklist()
        visible_menus = self.search_fetch(
            [('id', 'not in', blacklisted_menu_ids)],
            ['name', 'parent_id', 'action', 'web_icon'],
        )._filter_visible_menus()

        children_dict = defaultdict(list)
        for menu in visible_menus:
            children_dict[menu.parent_id.id].append(menu.id)

        app_info = {}

        def _set_app_id(menu_app_id, menu_id):
            app_info[menu_id] = menu_app_id
            for child_id in children_dict[menu_id]:
                _set_app_id(menu_app_id, child_id)

        for root_menu_id in children_dict[False]:
            _set_app_id(root_menu_id, root_menu_id)

        visible_menus = visible_menus.filtered(lambda menu: menu.id in app_info)

        xmlids = visible_menus._get_menuitems_xmlids()
        icon_attachments = self.env['ir.attachment'].sudo().search_read(
            domain=[
                ('res_model', '=', 'ir.ui.menu'),
                ('res_id', 'in', visible_menus._ids),
                ('res_field', '=', 'web_icon_data'),
            ],
            fields=['res_id', 'datas', 'mimetype'],
        )
        icon_attachments_res_id = {
            attachment['res_id']: attachment
            for attachment in icon_attachments
        }

        menus_dict = {}
        action_ids_by_type = defaultdict(list)
        for menu in visible_menus:
            menu_id = menu.id
            attachment = icon_attachments_res_id.get(menu_id)

            if action := menu.action:
                action_model = action._name
                action_id = action.id
                action_ids_by_type[action_model].append(action_id)
            else:
                action_model = False
                action_id = False

            menus_dict[menu_id] = {
                'id': menu_id,
                'name': menu.name,
                'app_id': app_info[menu_id],
                'action_model': action_model,
                'action_id': action_id,
                'web_icon': menu.web_icon,
                'web_icon_data': attachment['datas'].decode() if attachment else False,
                'web_icon_data_mimetype': attachment['mimetype'] if attachment else False,
                'xmlid': xmlids.get(menu_id, ""),
            }

        for model_name, action_ids in action_ids_by_type.items():
            self.env[model_name].sudo().browse(action_ids).fetch(['path'])

        for menu_dict in menus_dict.values():
            if menu_dict['action_model']:
                menu_dict['action_path'] = self.env[menu_dict['action_model']].sudo().browse(
                    menu_dict['action_id']
                ).path
            else:
                menu_dict['action_path'] = False
            menu_dict['children'] = children_dict[menu_dict['id']]

        menus_dict['root'] = {
            'id': False,
            'name': 'root',
            'children': children_dict[False],
        }
        return menus_dict

    def _load_menus_blacklist(self):
        hidden_ids = set(super()._load_menus_blacklist())
        restrictions = self.env['rbac.access.rule'].sudo().get_access_restrictions(
            user=self.env.user,
            company=self.env.company,
        )
        hidden_ids.update(restrictions.get('hide_menu_ids') or set())
        if restrictions.get('hide_technical_settings'):
            for xmlid in ('base.menu_administration', 'base.menu_management'):
                menu = self.env.ref(xmlid, raise_if_not_found=False)
                if menu:
                    hidden_ids.add(menu.id)
        if restrictions.get('hide_spreadsheet'):
            spreadsheet_menus = self.sudo().search([
                '|',
                ('name', 'ilike', 'spreadsheet'),
                ('action', 'ilike', 'spreadsheet'),
            ])
            hidden_ids.update(spreadsheet_menus.ids)
        return list(hidden_ids)
