import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register({url:'http://localhost:8080'});
import { afterEach, expect, mock, test } from 'bun:test';
import { useState } from 'react';
mock.module('@tanstack/react-start', () => ({useServerFn: (fn: unknown) => fn}));
mock.module('@/lib/installer-price.functions', () => ({getInstallerPriceFn: async () => null}));
const { render, fireEvent, cleanup } = await import('@testing-library/react');
const { SavedPriceLine } = await import('../src/components/trade/PriceSavedConfirmation');
const { showTradeSaved } = await import('../src/lib/trade-save-confirmation');
afterEach(cleanup);
test('editable saved amount opens editing without another save', () => {
  let writes=0;
  function Screen() {const [editing,setEditing]=useState(false); return <><SavedPriceLine amount={2500} at="2026-11-05T09:04:44Z" submitted onChange={()=>setEditing(true)}/>{editing && <input aria-label="Price" defaultValue={2500}/>}<button onClick={()=>writes++}>Submit</button></>;}
  const r=render(<Screen/>);
  fireEvent.click(r.getByRole('button',{name:'Change'}));
  expect((r.getByRole('textbox',{name:'Price'}) as HTMLInputElement).value).toBe('2500');
  expect(writes).toBe(0);
});
test('locked confirmation does not offer an edit command', () => {
  const r=render(<SavedPriceLine amount={2500} at="2026-11-05T09:04:44Z" submitted/>);
  expect(r.queryByRole('button')).toBeNull();
});
test('screen feedback remains scoped to the originating page', () => {
  window.history.replaceState({},'', '/field/test-job');
  let received: unknown;
  const listener=(e: Event)=>{received=(e as CustomEvent).detail;};
  window.addEventListener('trade-saved',listener);
  showTradeSaved('Electrician saved');
  window.removeEventListener('trade-saved',listener);
  expect(received).toEqual({path:'/field/test-job',line:'Electrician saved'});
});