import { component } from '@liquid-bricks/lib-component-builder/component/builder';

const comp = (() => component(componentName)
      .data('value', { fnc: () => 42 }))();
export default comp;
