export function reply(statusCode, data) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}

export function parseJson(body) {
  if (typeof body !== 'string' || body.length > 16_384) throw new Error('JSON_INVALIDO');
  try {
    const value = JSON.parse(body);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new Error('JSON_INVALIDO');
  }
}

export function pathDeviceId(event) {
  const id = event.pathParameters?.id;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new Error('DEVICE_ID_INVALIDO');
  return id;
}

export function workerSub(event) {
  const sub = event.requestContext?.authorizer?.lambda?.sub;
  if (typeof sub !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(sub)) throw new Error('NO_AUTORIZADO');
  return sub;
}

export function errorReply(error) {
  const code = error?.message || 'ERROR_INTERNO';
  if (code === 'NO_AUTORIZADO' || code === 'FIRMA_INVALIDA') return reply(401, { error: code });
  if (code === 'SIN_ACCESO') return reply(403, { error: code });
  if (code === 'NO_ENCONTRADO') return reply(404, { error: code });
  if (code === 'PUSH_NO_CONFIGURADO') return reply(503, { error: code });
  if (code === 'CONFIGURACION_INCOMPLETA') return reply(503, { error: code });
  if (code === 'DUPLICADO') return reply(202, { accepted: false, reason: code });
  if (code === 'ERROR_INTERNO') {
    console.error(error);
    return reply(500, { error: code });
  }
  return reply(400, { error: code });
}
