import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function resetAdmin(): Promise<void> {
  const email = 'admin@madmedsales.com';
  const password = 'Madmed2026!';

  // 기존 유저 찾기
  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('유저 목록 조회 실패:', listError.message);
    process.exit(1);
  }

  const existingUser = users.users.find((u) => u.email === email);
  if (!existingUser) {
    console.error('유저를 찾을 수 없습니다:', email);
    process.exit(1);
  }

  // 비밀번호 업데이트
  const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, {
    password,
  });

  if (error) {
    console.error('비밀번호 변경 실패:', error.message);
    process.exit(1);
  }

  console.log('Admin 비밀번호 변경 완료!');
  console.log('이메일:', email);
  console.log('User ID:', data.user.id);
}

resetAdmin();
