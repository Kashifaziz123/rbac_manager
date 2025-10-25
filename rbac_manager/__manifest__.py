# -*- coding: utf-8 -*-
{
    "name": "Role-Based Access Control (RBAC) Manager",
    "summary": "Take complete control of your Odoo security with enterprise-grade role-based access management. This advanced solution provides comprehensive access control, smart delegation, risk-based rights management, and complete audit trails - ensuring your ERP data stays secure while maintaining operational flexibility.
Key Features:

Advanced RBAC - Enterprise-level role and permission control with granular access rules
Smart Delegation - Flexible temporary rights delegation without compromising security
Risk Management - Risk-based rights assessment to identify and mitigate security gaps
Complete Audit Log - Track all user role changes and permission modifications with detailed history
Hassle-Free Setup - Intuitive interface that simplifies complex permission management

Perfect for: Organizations requiring strict access controls, compliance requirements, or managing large teams with diverse permission needs.
Improve your ERP security. Hassle-free.",
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
