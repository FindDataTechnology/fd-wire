# gate-boot-schema-creation

启动期不再逐模块 create_all：统一开关 + 生产只校验，消除启动 60-75s 撞 liveness 的根因
