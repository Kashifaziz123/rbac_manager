# -*- coding: utf-8 -*-
{
    "name": "Permission Management System",
    "summary": "Permission Management System",
    "description": """Permission Management System""",
    "version": "18.0.0.0.1",
    "category": "Extra Tools",
    "author": "Alhaditech",
    "website": "alhaditech.com",
    'price': 350, 'currency': 'USD',
    "license": "Other proprietary",
    "application": True,
    "installable": True,
    "auto_install": False,
    'images': ['static/description/rbac.gif'],
    'post_init_hook': 'post_init_hook',
    "depends": ['base', 'web', 'auth_signup', 'account'],
    "data": [
        'security/groups.xml',
        'security/ir.model.access.csv',
        'views/res_users_views_user_roles.xml',
        'views/res_users_views_user_permissions.xml',
        'views/res_users_views_manage_permissions.xml',
        'views/res_users_views_super_admin.xml',
        'views/res_groups_view.xml',
        'views/request_rbac_permission_view.xml',
        'views/rbac_audit_views.xml',

        'views/menu.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'rbac_manager/static/src/xml/*.xml',
            'rbac_manager/static/src/css/*.css',
            'rbac_manager/static/src/js/*.js',
        ],
    },
}
