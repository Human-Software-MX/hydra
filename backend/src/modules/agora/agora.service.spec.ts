import {
  AGORA_CHANNEL,
  ESTADO_AGORA_A_HYDRA,
  agoraConfigurado,
  construirPayloadTicket,
  displayIdDeRespuesta,
  mapEstadoFromAgora,
  mapEstadoToAgora,
  mapPrioridadFromAgora,
  mapPrioridadToAgora,
  refDeRespuesta,
  transicionAgora,
} from './agora.config';

/**
 * Cobertura de la capa pura de la integración con Agora: mapeo de enums
 * (ticket_status / ticket_priority / ticket_channel del schema de Agora) y
 * construcción del payload de `POST /api/v1/accounts/:id/tickets`.
 *
 * No toca HTTP ni Prisma: `AgoraService` sólo orquesta estas funciones.
 */
const CFG_VACIA = { defaultCategoryId: '', defaultSubcategoryId: '' };

describe('agoraConfigurado', () => {
  it('exige baseUrl, token y accountId', () => {
    const base = {
      baseUrl: 'https://agora.example',
      apiToken: 'tok',
      accountId: '1',
      webhookSecret: '',
      httpTimeoutMs: 10_000,
      ...CFG_VACIA,
    };
    expect(agoraConfigurado(base)).toBe(true);
    expect(agoraConfigurado({ ...base, baseUrl: '' })).toBe(false);
    expect(agoraConfigurado({ ...base, apiToken: '' })).toBe(false);
    expect(agoraConfigurado({ ...base, accountId: '' })).toBe(false);
  });
});

describe('mapeo de prioridad', () => {
  it('traduce las cuatro prioridades de Hydra al enum ticket_priority', () => {
    expect(mapPrioridadToAgora('Baja')).toBe('low');
    expect(mapPrioridadToAgora('Media')).toBe('medium');
    expect(mapPrioridadToAgora('Alta')).toBe('high');
    expect(mapPrioridadToAgora('Urgente')).toBe('urgent');
  });

  it('cae a medium ante valores ausentes o desconocidos', () => {
    expect(mapPrioridadToAgora(undefined)).toBe('medium');
    expect(mapPrioridadToAgora('Inventada')).toBe('medium');
  });

  it('es reversible', () => {
    for (const prioridad of ['Baja', 'Media', 'Alta', 'Urgente']) {
      expect(mapPrioridadFromAgora(mapPrioridadToAgora(prioridad))).toBe(prioridad);
    }
    expect(mapPrioridadFromAgora(null)).toBe('Media');
  });
});

describe('mapeo de estado', () => {
  it('cubre los ocho valores del enum ticket_status', () => {
    expect(mapEstadoFromAgora('open')).toBe('Abierto');
    expect(mapEstadoFromAgora('in_progress')).toBe('En Progreso');
    expect(mapEstadoFromAgora('escalated')).toBe('Escalado');
    expect(mapEstadoFromAgora('waiting_client')).toBe('Esperando Cliente');
    expect(mapEstadoFromAgora('waiting_internal')).toBe('Esperando Interno');
    expect(mapEstadoFromAgora('resolved')).toBe('Resuelto');
    expect(mapEstadoFromAgora('closed')).toBe('Cerrado');
    expect(mapEstadoFromAgora('cancelled')).toBe('Cancelado');
  });

  it('devuelve null ante estados ausentes o desconocidos (no inventa estado)', () => {
    expect(mapEstadoFromAgora(null)).toBeNull();
    expect(mapEstadoFromAgora('teleported')).toBeNull();
  });

  it('el mapa inverso es exacto para todo el enum', () => {
    for (const [agora, hydra] of Object.entries(ESTADO_AGORA_A_HYDRA)) {
      expect(mapEstadoToAgora(hydra)).toBe(agora);
    }
    expect(mapEstadoToAgora('Inexistente')).toBeNull();
  });
});

describe('transicionAgora', () => {
  it('mapea sólo los estados con acción member en el controlador de Agora', () => {
    expect(transicionAgora('Resuelto')).toBe('resolve');
    expect(transicionAgora('Cerrado')).toBe('close');
    expect(transicionAgora('Abierto')).toBe('reopen');
  });

  it('no inventa transición para estados sin ruta expuesta', () => {
    expect(transicionAgora('Escalado')).toBeNull();
    expect(transicionAgora('Esperando Cliente')).toBeNull();
    expect(transicionAgora('Cancelado')).toBeNull();
  });
});

describe('construirPayloadTicket', () => {
  const dto = {
    contratoId: 'ctr-1',
    titulo: 'Fuga en banqueta',
    descripcion: 'Reportada por el titular',
    prioridad: 'Alta',
    creadoPor: 'user-1',
  };

  it('envuelve en `ticket` y traduce título/descripción/prioridad/canal', () => {
    const { ticket } = construirPayloadTicket(dto, CFG_VACIA);
    expect(ticket.title).toBe('Fuga en banqueta');
    expect(ticket.description).toBe('Reportada por el titular');
    expect(ticket.priority).toBe('high');
    expect(ticket.channel).toBe(AGORA_CHANNEL);
  });

  it('adjunta la trazabilidad de Hydra en custom_attributes', () => {
    const { ticket } = construirPayloadTicket(
      { ...dto, tramiteId: 'trm-9', quejaId: 'qja-3' },
      CFG_VACIA,
    );
    expect(ticket.custom_attributes).toEqual({
      origen: 'hydra',
      hydra_contrato_id: 'ctr-1',
      hydra_tramite_id: 'trm-9',
      hydra_queja_id: 'qja-3',
    });
  });

  it('omite las claves de trazabilidad no provistas', () => {
    const { ticket } = construirPayloadTicket(dto, CFG_VACIA);
    expect(ticket.custom_attributes).toEqual({ origen: 'hydra', hydra_contrato_id: 'ctr-1' });
  });

  it('NO envía contract_number salvo que el llamante lo pida (Agora lo valida por SOAP y responde 422)', () => {
    expect(construirPayloadTicket(dto, CFG_VACIA).ticket).not.toHaveProperty('contract_number');
    const conContrato = construirPayloadTicket({ ...dto, ceaContractNumber: '523160' }, CFG_VACIA);
    expect(conContrato.ticket.contract_number).toBe('523160');
  });

  it('incluye categoría/subcategoría por defecto sólo cuando están configuradas', () => {
    expect(construirPayloadTicket(dto, CFG_VACIA).ticket).not.toHaveProperty('ticket_category_id');
    const conCat = construirPayloadTicket(dto, {
      defaultCategoryId: '7',
      defaultSubcategoryId: '21',
    });
    expect(conCat.ticket.ticket_category_id).toBe('7');
    expect(conCat.ticket.ticket_subcategory_id).toBe('21');
  });
});

describe('lectura de la respuesta de Agora', () => {
  it('agoraRef usa folio y cae a display_id', () => {
    expect(refDeRespuesta({ folio: 'CEA-2026-0001', display_id: 42 })).toBe('CEA-2026-0001');
    expect(refDeRespuesta({ display_id: 42 })).toBe('42');
    expect(refDeRespuesta({ folio: '  ' })).toBeNull();
    expect(refDeRespuesta(null)).toBeNull();
  });

  it('el lookup remoto usa display_id (el controlador busca por display_id, no por folio)', () => {
    expect(displayIdDeRespuesta({ folio: 'CEA-2026-0001', display_id: 42 })).toBe('42');
    expect(displayIdDeRespuesta({ folio: 'CEA-2026-0001' })).toBeNull();
    expect(displayIdDeRespuesta(undefined)).toBeNull();
  });
});
