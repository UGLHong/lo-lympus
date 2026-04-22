import { redirect } from 'react-router';

export async function loader() {
  return redirect('/projects');
}

export default function NewProjectShim() {
  return null;
}
