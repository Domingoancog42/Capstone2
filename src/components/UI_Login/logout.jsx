import React, { useState } from "react";
import { LogOut } from "lucide-react";
import Button from "../UI/button";
import Modal from "../UI/modal";
import { logout } from "../../services/api";

export default function Logout({ onLogout }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);

    try {
      await logout();
    } finally {
      setLoading(false);
      setOpen(false);
      onLogout();
    }
  };

  return (
    <>
      <Button variant="secondary" icon={LogOut} onClick={() => setOpen(true)}>
        Logout
      </Button>

      <Modal
        open={open}
        title="Confirm Logout"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" icon={LogOut} loading={loading} onClick={handleLogout}>
              Logout
            </Button>
          </>
        }
      >
      </Modal>
    </>
  );
}
