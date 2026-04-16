import { component } from '@liquid-bricks/lib-component-builder/component/builder';

export const smoke = component('agent-component-demo-smoke')
  .data('message')
  .task('echo', {
    deps: _ => [
      _.data.message,
    ],
    fnc: async ({ deps: { data: { message } } }) => ({
      ok: true,
      message: message ?? 'Hello from the agent-component demo',
      timestamp: new Date().toISOString(),
    }),
  })
  .task('done', {
    deps: _ => [
      _.task.echo,
    ],
    fnc: async ({ deps }) => deps,
  });

export default [
  smoke,
];
