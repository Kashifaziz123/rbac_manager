from . import models,wizard



def post_init_hook(env):
    env['res.users']._init_existing_users_on_module_install()
