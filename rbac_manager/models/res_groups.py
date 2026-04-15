# -*- coding: utf-8 -*-
from collections import defaultdict
from odoo import api, fields, models, _


# Local replacements for functions removed in Odoo 19
def name_boolean_group(id):
    return 'in_group_' + str(id)


def name_selection_groups(ids):
    return 'sel_groups_' + '_'.join(str(it) for it in sorted(ids))


# ----------------------------------------------------------
# Basic res.groups
# ----------------------------------------------------------

class ResGroups(models.Model):
    _inherit = 'res.groups'

    # NOTE: full_name is already defined in Odoo 19's res.groups (computed via privilege_id)
    # We do NOT redefine it here to avoid conflicts.

    risk_level = fields.Selection(
        [('low', 'low'), ('medium', 'medium'), ('high', 'high'), ('critical', 'critical')],
        string="Risk Level", default='low', required=False)
    description = fields.Text(string="Description")

    # NOTE: In Odoo 19, the reverse of implied_ids is already defined as implied_by_ids
    # using the same relation table (res_groups_implied_rel, hid, gid).
    # We remove the custom inverse_implied_ids field to avoid DB-level conflicts.
    # All internal code now uses implied_by_ids instead.

    def get_toggle_value(self, group_id):
        """Returns True if the current user has the group with the given group_id, otherwise False."""
        group = self.env['res.groups'].browse(group_id)
        return group.id in self.env.user.group_ids.ids if group else False

    @api.model
    def get_groups_by_application(self):
        """Return all groups classified by application (module category), as a list::

                [(app, kind, groups, category_name), ...],

            where ``app`` and ``groups`` are recordsets, and ``kind`` is either
            ``'boolean'`` or ``'selection'``. Applications are given in sequence
            order.  If ``kind`` is ``'selection'``, ``groups`` are given in
            reverse implication order.

            Odoo 19: groups are organised via privilege_id → category_id.
        """

        def linearize(app, gs, category_name):
            # Groups that are mutually exclusive (disjoint) → selection
            # This covers the old 'User Type' special-case and similar setups.
            if len(gs) > 1 and any(g.disjoint_ids & gs for g in gs):
                return (app, 'selection', gs.sorted(lambda g: len(g.all_implied_ids & gs)), category_name)
            # Determine sequence order: a group appears after its implied groups
            order = {g: len(g.all_implied_ids & gs) for g in gs}
            if len(set(order.values())) == len(gs):
                return (app, 'boolean', gs.sorted(key=order.get), category_name)
            return (app, 'boolean', gs, category_name)

        # Classify all groups by category (Odoo 19: via privilege_id.category_id)
        by_app, others = defaultdict(self.browse), self.browse()
        for g in self.search([]):
            category = g.privilege_id.category_id if g.privilege_id else None
            if category:
                by_app[category] += g
            else:
                others += g

        # Build the result
        res = []
        for app, gs in sorted(by_app.items(), key=lambda it: it[0].sequence or 0):
            if app.parent_id:
                res.append(linearize(app, gs, (app.parent_id.sequence, app.parent_id.name)))
            else:
                res.append(linearize(app, gs, (100, 'Other')))

        if others:
            res.append((self.env['ir.module.category'], 'boolean', others, (100, 'Other')))
        return res

    def get_categories_groups_json(self, user_id):
        sorted_tuples = self.get_groups_by_application()
        # Role templates are inactive (active=False) users — must bypass active_test
        # so their group_ids are readable. sudo() avoids access-right filtering too.
        res_user = self.env['res.users'].with_context(active_test=False).sudo().browse([user_id])
        json_dict = {}

        def get_toggle_value(group_id):
            group = self.env['res.groups'].browse(group_id)
            if group:
                return group.id in res_user.group_ids.ids
            return False

        for app, kind, gs, category_name in sorted_tuples:
            app_name = app.name or 'Other'

            if kind == 'boolean':
                json_dict.setdefault(app_name, {}).update({
                    name_boolean_group(g.id): {
                        'group': {'id': g.id, 'name': g.name, 'risk_level': g.risk_level},
                        'groups': False,
                        'value': get_toggle_value(g.id),
                        'values': False,
                        'category_name': str(category_name),
                    }
                    for g in gs
                })

            elif kind == 'selection':
                field_name = name_selection_groups(gs.ids)
                user_group_ids = set(res_user.group_ids.ids)
                group_ids = [g.id for g in reversed(gs) if g.id in user_group_ids]
                last_match = group_ids[0] if len(group_ids) > 0 else False

                json_dict.setdefault(app_name, {}).setdefault(field_name, {}).update({
                    'group': False,
                    'groups': [{'id': group.id, 'name': group.name, 'risk_level': group.risk_level}
                               for group in gs],
                    'value': last_match,
                    'values': list(group_ids),
                    'category_name': str(category_name),
                })

        return json_dict

    def write(self, vals):
        result = super().write(vals)
        return result

    @api.model_create_multi
    def create(self, vals_list):
        result = super().create(vals_list)
        return result
