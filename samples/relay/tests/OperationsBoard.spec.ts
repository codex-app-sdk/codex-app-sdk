import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import OperationsBoard from '../src/renderer/components/OperationsBoard.vue';
import { relayOperationsSnapshot } from './fakes';

describe('OperationsBoard', () => {
  it('renders the selected exception, route, KPIs, and actionable queue', async () => {
    const snapshot = relayOperationsSnapshot();
    const wrapper = mount(OperationsBoard, {
      props: {
        accountLabel: 'dispatcher@example.com',
        selectedShipment: snapshot.shipments[0]!,
        snapshot,
      },
    });

    expect(wrapper.text()).toContain('On time86%');
    expect(wrapper.text()).toContain('SHP-4827');
    expect(wrapper.text()).toContain('Chicago → Dallas');
    expect(wrapper.text()).toContain('Customs hold');
    expect(wrapper.findAll('.exception-row')).toHaveLength(3);

    await wrapper.findAll('.exception-row')[1]!.trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['SHP-7152']]);

    await wrapper.findAll('.shipment-actions button')[1]!.trigger('click');
    expect(wrapper.emitted('action')).toStrictEqual([[
      'compare-recovery',
      snapshot.shipments[0],
    ]]);
  });

  it('disables every contextual action while a prompt is being submitted', () => {
    const snapshot = relayOperationsSnapshot();
    const wrapper = mount(OperationsBoard, {
      props: {
        actionPending: true,
        selectedShipment: snapshot.shipments[0]!,
        snapshot,
      },
    });

    expect(wrapper.findAll('.shipment-actions button').map((button) => button.attributes('disabled')))
      .toStrictEqual(['', '', '']);
  });
});
