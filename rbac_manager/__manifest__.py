# -*- coding: utf-8 -*-
{
    "name": "Permission Management System",
    "summary": "Permission Management System",
    "description": """Permission Management System""",
    "version": "18.0.0.0.1",
    "category": "Extra Tools",
    "author": "",
    "website": "",
    "license": "Other proprietary",
    "application": True,
    "installable": True,
    "auto_install": False,
    "depends": ['base', 'web', 'auth_signup', 'account'],
    "data": [
        'security/groups.xml',
        'security/ir.model.access.csv',
        'views/res_users_views_user_roles.xml',
        'views/res_users_views_user_permissions.xml',
        'views/res_users_views_manage_permissions.xml',
        'views/res_users_views_super_admin.xml',
        'views/res_groups_view.xml',

        'views/views.xml',
        'views/ir_module_category.xml',
        'views/menu.xml',
        'wizard/wizard.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'rbac_manager/static/src/xml/*.xml',
            'rbac_manager/static/src/js/*.js',
        ],
    },
}
