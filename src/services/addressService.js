import api from "./api";

/**
 * The addresses added in Settings > Add Address.
 *
 * Every response carries the whole list (`addresses`) together with `canManage`, so a screen can
 * redraw straight from a save without asking again. The api client publishes the `addresses`
 * auto-refresh topic for each mutation, which is what refreshes the address pickers in the other
 * open tabs.
 */
export async function fetchAddresses() {
  const response = await api.get("/addresses.php");
  return response.data;
}

export async function createAddress(payload) {
  const response = await api.post("/addresses.php", payload);
  return response.data;
}

export async function updateAddress(payload) {
  const response = await api.put("/addresses.php", payload);
  return response.data;
}

export async function deleteAddress(addressId) {
  const response = await api.delete("/addresses.php", {
    data: { id: addressId },
  });
  return response.data;
}
