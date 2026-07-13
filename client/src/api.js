async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getState: async () => {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`Board unavailable (${res.status})`);
    return res.json();
  },
  checkIn: (apptId) => post(`/api/appointments/${apptId}/checkin`),
  addWalkIn: (data) => post('/api/patients', data),
  assignRoom: (apptId, roomId) => post(`/api/appointments/${apptId}/room`, { room_id: roomId }),
  readyForCheckout: (apptId) => post(`/api/appointments/${apptId}/ready-checkout`),
  checkout: (apptId) => post(`/api/appointments/${apptId}/checkout`),
  markClean: (roomId) => post(`/api/rooms/${roomId}/clean`),
  raiseFlag: (roomId, requestType) => post(`/api/rooms/${roomId}/flags`, { request_type: requestType }),
  resolveFlag: (flagId) => post(`/api/flags/${flagId}/resolve`),
  setSim: (enabled) => post('/api/sim', { enabled }),
  reset: () => post('/api/reset'),
};
