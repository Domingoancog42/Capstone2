const clients = new WeakMap();

// GIS owns one client per page. Keep its callback current across React effect
// replay and login-screen remounts without initializing the SDK again.
export function registerGoogleCredentialHandler(google, clientId, handler) {
  let client = clients.get(google);

  if (!client || client.clientId !== clientId) {
    client = { clientId, handlers: new Set() };
    google.initialize({
      client_id: clientId,
      ux_mode: "popup",
      callback: (response) => {
        const handlers = Array.from(client.handlers);
        handlers[handlers.length - 1]?.(String(response?.credential || ""));
      },
    });
    clients.set(google, client);
  }

  client.handlers.add(handler);
  return () => client.handlers.delete(handler);
}
