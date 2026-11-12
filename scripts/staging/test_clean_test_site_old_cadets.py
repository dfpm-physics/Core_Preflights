"""Offline tests for clean_test_site_old_cadets.py (no database)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import clean_test_site_old_cadets as c  # noqa: E402


class Clean(unittest.TestCase):
    def test_redacts_secret_columns_on_every_auth_table(self):
        row = {"id": 1, "email": "a@b", "encrypted_password": "x", "token": "t", "recovery_token": "t", "secret": "s",
               "identity_data": {"k": 1}, "auth_code": "a", "authorization_code": "b", "code_challenge": "c", "nonce": "n", "refresh_token_hash": "h", "public_key": "p", "created_at": "now"}
        for table in ("auth.users", "auth.mfa_factors", "auth.identities", "auth.refresh_tokens"):
            self.assertEqual(c.redact(table, [row]), [{"id": 1, "email": "a@b", "created_at": "now"}], table)
        self.assertEqual(c.redact("app.grades", [row]), [row])          # other schemas are kept whole

    def test_file_names_are_short_and_distinct(self):
        a = "enrollments>" + ">".join(f"app.table_{i}_with_a_long_name" for i in range(8))
        b = a + "x"
        self.assertLess(len(c.fname(a)), 60)
        self.assertNotEqual(c.fname(a), c.fname(b))
        self.assertTrue(c.fname(a).endswith(".json"))

    def test_uuid_array_parameters_carry_a_cast(self):
        import re
        src = Path(c.__file__).read_text(encoding="utf-8")
        for m in re.finditer(r"(?:enrollments|auth\.users) WHERE id = ANY\(%s([^)]*)\)", src):
            self.assertEqual(m.group(1), "::uuid[]", m.group(0))
        self.assertEqual(len(re.findall(r"WHERE id = ANY\(%s::uuid\[\]\)", src)), 4)


if __name__ == "__main__":
    unittest.main()
