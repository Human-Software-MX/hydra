import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { InternalGuard } from './internal.guard';
import { RolesGuard } from './roles.guard';
import { PortalGuard } from './portal.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_PORTAL_KEY } from './allow-portal.decorator';
import { ROLES_KEY } from './roles.decorator';
import { ContabilidadController } from '../contabilidad/contabilidad.controller';
import { LecturasController } from '../lecturas/lecturas.controller';
import { RutasController } from '../rutas/rutas.controller';
import { PagosController } from '../pagos/pagos.controller';
import { TarifasController } from '../tarifas/tarifas.controller';
import { SolicitudesController } from '../solicitudes/solicitudes.controller';

/**
 * C2 — cobertura de autorización a nivel de guard (chain de APP_GUARD).
 *
 * Se optó por probar los guards con `ExecutionContext`/`Reflector` mockeados
 * en lugar de un e2e con supertest: la estrategia JWT (`JwtStrategy.validate`)
 * consulta `prisma` (perfil del usuario), así que un e2e real exigiría una BD
 * viva — prohibido aquí. Los guards concentran TODA la lógica de audiencia y
 * rol introducida en el Batch A, por lo que probarlos da cobertura real.
 *
 * Escenarios equivalentes a los pedidos:
 *   (a) sin usuario en ruta interna      → InternalGuard 403
 *   (b) token CLIENTE en ruta interna    → InternalGuard 403
 *   (c) token CLIENTE en ruta @AllowPortal + PortalGuard → 200
 *   (d) token interno en ruta interna    → 200 ; interno en ruta portal (PortalGuard) → 403
 *   (e) ruta @Public()                   → JwtAuthGuard/InternalGuard la dejan pasar
 */

/** ExecutionContext mínimo con un `user` opcional en el request. */
function ctxWith(user?: { role?: string }): ExecutionContext {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** Reflector falso que responde por clave de metadata. */
function reflectorReturning(map: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => map[key],
  } as unknown as Reflector;
}

describe('JwtAuthGuard (@Public bypass)', () => {
  it('(e) deja pasar sin autenticar cuando la ruta es @Public()', () => {
    const guard = new JwtAuthGuard(reflectorReturning({ [IS_PUBLIC_KEY]: true }));
    expect(guard.canActivate(ctxWith())).toBe(true);
  });

  it('delega en Passport (super.canActivate) cuando la ruta NO es pública', () => {
    const spy = jest
      .spyOn(AuthGuard('jwt').prototype as { canActivate: () => boolean }, 'canActivate')
      .mockReturnValue(true);
    const guard = new JwtAuthGuard(reflectorReturning({ [IS_PUBLIC_KEY]: undefined }));
    expect(guard.canActivate(ctxWith())).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('InternalGuard (separación de audiencia)', () => {
  it('(a) 403 cuando no hay usuario en una ruta interna', () => {
    const guard = new InternalGuard(reflectorReturning({}));
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });

  it('(b) 403 para un token CLIENTE en una ruta interna', () => {
    const guard = new InternalGuard(reflectorReturning({}));
    expect(() => guard.canActivate(ctxWith({ role: 'CLIENTE' }))).toThrow(ForbiddenException);
  });

  it('(c) permite a un CLIENTE cuando la ruta es @AllowPortal()', () => {
    const guard = new InternalGuard(reflectorReturning({ [ALLOW_PORTAL_KEY]: true }));
    expect(guard.canActivate(ctxWith({ role: 'CLIENTE' }))).toBe(true);
  });

  it('(d) permite a un rol interno en una ruta interna', () => {
    const guard = new InternalGuard(reflectorReturning({}));
    expect(guard.canActivate(ctxWith({ role: 'ADMIN' }))).toBe(true);
    expect(guard.canActivate(ctxWith({ role: 'LECTURISTA' }))).toBe(true);
  });

  it('(e) deja pasar cualquier ruta @Public() sin evaluar rol', () => {
    const guard = new InternalGuard(reflectorReturning({ [IS_PUBLIC_KEY]: true }));
    expect(guard.canActivate(ctxWith(undefined))).toBe(true);
  });
});

describe('PortalGuard (cierra el otro lado del portal)', () => {
  it('(c) permite a un token CLIENTE', () => {
    expect(new PortalGuard().canActivate(ctxWith({ role: 'CLIENTE' }))).toBe(true);
  });

  it('(d) 403 para un rol interno en una ruta del portal', () => {
    expect(() => new PortalGuard().canActivate(ctxWith({ role: 'ADMIN' }))).toThrow(
      ForbiddenException,
    );
  });

  it('403 cuando no hay usuario', () => {
    expect(() => new PortalGuard().canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });
});

describe('RolesGuard (@Roles opcional)', () => {
  it('sin metadata @Roles → cualquier usuario (interno) autenticado pasa', () => {
    const guard = new RolesGuard(reflectorReturning({ [ROLES_KEY]: undefined }));
    expect(guard.canActivate(ctxWith({ role: 'OPERADOR' }))).toBe(true);
  });

  it('con @Roles y rol coincidente → pasa', () => {
    const guard = new RolesGuard(reflectorReturning({ [ROLES_KEY]: ['ADMIN', 'SUPER_ADMIN'] }));
    expect(guard.canActivate(ctxWith({ role: 'ADMIN' }))).toBe(true);
  });

  it('con @Roles y rol NO coincidente → rechaza', () => {
    const guard = new RolesGuard(reflectorReturning({ [ROLES_KEY]: ['ADMIN'] }));
    expect(guard.canActivate(ctxWith({ role: 'LECTURISTA' }))).toBe(false);
  });
});

/**
 * Cobertura end-to-end del cableado `@Roles` real: usa un `Reflector` real que
 * lee la metadata emitida por los decoradores en los controladores reales, en
 * lugar de un mapa falso. Prueba que la matriz RBAC (tasks/rbac-proposal.md)
 * queda efectivamente aplicada por controlador.
 */
describe('RolesGuard — @Roles reales por controlador (matriz RBAC)', () => {
  const guard = new RolesGuard(new Reflector());

  /** ExecutionContext cuya clase es un controlador real (con su @Roles). */
  function ctxForClass(cls: unknown, role?: string): ExecutionContext {
    const req = { user: role ? { role } : undefined };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => function noop() {},
      getClass: () => cls,
    } as unknown as ExecutionContext;
  }

  it('LECTURISTA es RECHAZADO en /contabilidad (fuera de su grupo)', () => {
    expect(guard.canActivate(ctxForClass(ContabilidadController, 'LECTURISTA'))).toBe(false);
  });

  it('LECTURISTA es RECHAZADO en /pagos (fuera de su grupo)', () => {
    expect(guard.canActivate(ctxForClass(PagosController, 'LECTURISTA'))).toBe(false);
  });

  it('LECTURISTA es PERMITIDO en /lecturas y /rutas (su grupo de campo)', () => {
    expect(guard.canActivate(ctxForClass(LecturasController, 'LECTURISTA'))).toBe(true);
    expect(guard.canActivate(ctxForClass(RutasController, 'LECTURISTA'))).toBe(true);
  });

  it('OPERADOR es RECHAZADO en /tarifas y /pagos (sólo admin / atención)', () => {
    expect(guard.canActivate(ctxForClass(TarifasController, 'OPERADOR'))).toBe(false);
    expect(guard.canActivate(ctxForClass(PagosController, 'OPERADOR'))).toBe(false);
  });

  it('OPERADOR es PERMITIDO en /solicitudes (grupo servicios)', () => {
    expect(guard.canActivate(ctxForClass(SolicitudesController, 'OPERADOR'))).toBe(true);
  });

  it('ATENCION_CLIENTES es PERMITIDO en /pagos, RECHAZADO en /tarifas', () => {
    expect(guard.canActivate(ctxForClass(PagosController, 'ATENCION_CLIENTES'))).toBe(true);
    expect(guard.canActivate(ctxForClass(TarifasController, 'ATENCION_CLIENTES'))).toBe(false);
  });

  it('ATENCION_CLIENTES es RECHAZADO en /lecturas (grupo de campo)', () => {
    expect(guard.canActivate(ctxForClass(LecturasController, 'ATENCION_CLIENTES'))).toBe(false);
  });

  it('ADMIN y SUPER_ADMIN son PERMITIDOS en TODOS los controladores', () => {
    const controllers = [
      ContabilidadController,
      PagosController,
      TarifasController,
      LecturasController,
      RutasController,
      SolicitudesController,
    ];
    for (const cls of controllers) {
      expect(guard.canActivate(ctxForClass(cls, 'ADMIN'))).toBe(true);
      expect(guard.canActivate(ctxForClass(cls, 'SUPER_ADMIN'))).toBe(true);
    }
  });
});
