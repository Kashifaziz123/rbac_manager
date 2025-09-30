from odoo import models, fields, api


class UserTemplateWizard(models.TransientModel):
    _name = 'user.template.wizard'
    _description = 'User Template Wizard'

    type = fields.Selection(
        selection=[
            ('Template', "Template"),
            ('User', "User"),
        ],
        default="Template", string="Select Type", required=True)
    template_id = fields.Many2one(
        'res.users',
        string='Template',
        domain=[('active', '=', False), ('name', 'ilike', 'template')],
    )
    user_id = fields.Many2one('res.users', string="User")

    group_ids = fields.Many2many(
        'res.groups',
        string="New Access Rights",
        help="These are the access rights that the selected User/Template has but the target user does not have.",
        readonly=False,
        store=False,
    )

    display_group_names = fields.Many2many(
        'res.groups',
        string="Access Rights Display",
        compute="_compute_display_group_names",
        store=True,
        readonly=False
    )

    @api.onchange('type')
    def _onchange_type(self):
        self.template_id = False

    @api.depends('group_ids')
    def _compute_display_group_names(self):
        for wizard in self:
            wizard.display_group_names = wizard.group_ids

    @api.onchange('template_id', 'user_id')
    def _compute_missing_groups(self):
        """Compute access groups that the selected template/user has but the target user does not."""
        active_user = self.env['res.users'].browse(self._context.get('active_id'))
        selected_user = self.template_id if self.type == 'Template' else self.user_id

        if selected_user and active_user:
            selected_groups = selected_user.groups_id
            active_groups = active_user.groups_id
            missing_groups = selected_groups.filtered(lambda g: g not in active_groups)
            self.group_ids = [(6, 0, missing_groups.ids)]

    def apply_template(self):
        target_user = self.env['res.users'].browse(self._context.get('active_id'))
        if not target_user:
            raise ValueError("No target user found!")

        if not self.display_group_names:
            raise ValueError("No groups selected to assign!")

        # Assign only the selected groups
        target_user.groups_id = [(4, group.id) for group in self.display_group_names]

        message = f"Selected access rights successfully assigned to '{target_user.name}'."
        return {
            'type': 'ir.actions.client',
            'tag': 'reload',
            'params': {'message': message}
        }
