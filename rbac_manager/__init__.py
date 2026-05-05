from . import models,wizard
from . import controllers



def post_init_hook(env):
    env['res.users']._init_existing_users_on_module_install()
