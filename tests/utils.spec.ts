import { expect } from 'chai';

import { Semaphore, functionalizeConstructor } from '../src/utils';

describe('utils', async () => {
  describe('functionalizeConstructor', () => {
    // functionalize the constructor and invoke it
    const call = <R>(f: (() => R) | (new () => R)): R =>
      functionalizeConstructor(f)();

    it('should work for arrow functions', () => {
      // arrow function returning primitive type
      expect(call(() => 1)).to.equal(1);

      // arrow function returning object type
      expect(call(() => [])).to.be.an('array').that.is.empty;

      // arrow function returning object type
      expect(call(() => ({}))).to.be.an('object').that.is.empty;
    });

    it('should work for class constructors', () => {
      // constructor
      expect(call(Map)).to.be.an.instanceOf(Map).that.is.empty;

      // constructor
      expect(call(Set)).to.be.an.instanceOf(Set).that.is.empty;

      class CustomClass0 {
        constructor() {}
      }
      // custom class
      expect(call(CustomClass0)).to.be.an.instanceOf(CustomClass0);

      class CustomClass1 {
        a: number;
        constructor() {
          this.a = 1;
        }
      }
      // custom class that sets a property
      expect(call(CustomClass1))
        .to.be.an.instanceOf(CustomClass1)
        .that.has.property('a', 1);
    });

    it('should work for normal functions', () => {
      function CustomFunction0() {
        return 1;
      }
      // custom function returning primitive type
      expect(call(CustomFunction0)).to.equal(1);

      function CustomFunction1() {
        return [];
      }
      // custom function returning object type
      expect(call(CustomFunction1)).to.be.an('array').that.is.empty;
    });

    it('should work for constructor functions', () => {
      function CustomFunction2() {}
      // custom constructor function
      expect(call(CustomFunction2)).to.be.an('object').that.is.empty;

      function CustomFunction3() {}
      CustomFunction3.prototype = { a: 1 };
      // custom constructor function with property
      expect(call(CustomFunction3))
        .to.be.an('object')
        .that.has.property('a', 1);

      function CustomFunction4() {
        this.a = 1;
      }
      // custom constructor function
      expect(call(CustomFunction4))
        .to.be.an('object')
        .that.has.property('a', 1);
    });
  });

  describe('Semaphore', () => {
    const expectedTime = 1000;
    const timeQuantum = 10;
    // throughput = concurrency / timeQuantum
    // expectedTime = numTasks / throughput = numTasks * timeQuantum / concurrency
    const withLength = async (concurrency: number) => {
      let critical = 0;
      let peak = 0;
      const semaphore = new Semaphore(concurrency);
      const numTasks = Math.ceil((expectedTime * concurrency) / timeQuantum);
      const tasks = Array.from({ length: numTasks }, () =>
        semaphore.with(async () => {
          critical += 1;
          peak = Math.max(peak, critical);
          const random = Math.random() * timeQuantum;
          await new Promise((resolve) => setTimeout(resolve, random));
          critical -= 1;
        }),
      );
      await Promise.all(tasks);
      expect(peak).to.be.at.most(concurrency);
    };
    it('should work as mutex', () => withLength(1));
    it('should work as semaphore', () => withLength(10));
  });
});
