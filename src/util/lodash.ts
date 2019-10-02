import camelCase from 'lodash/camelCase';
import capitalize from 'lodash/capitalize';
import get from 'lodash/get';
import has from 'lodash/has';
import isEmpty from 'lodash/isEmpty';
import isEqual from 'lodash/isEqual';
import isString from 'lodash/isString';
import set from 'lodash/set';
import unset from 'lodash/unset';

/**
 * This is a wrapper around lodash functions. It allows us to optimize builds and not import all of lodash.
 */
export const lodash = {
  capitalize,
  camelCase,
  get,
  set,
  has,
  unset,
  isEqual,
  isEmpty,
  isObject: (value) => {
    const type = typeof value;
    return value != null && (type === 'object' || type === 'function');
  },
  isString,
  isUndefined: (value) => {
    return value === undefined;
  },
  isNull: (value) => {
    return value === null;
  },
  uniq: (items) => {
    return items.filter((value, index, self) => {
      return self.indexOf(value) === index;
    });
  },
  // DO NOT ADD ANY ITEMS THAT CAN BE REPLACED WITH ES6.
  // https://www.sitepoint.com/lodash-features-replace-es6/
};

/**
 * Items NOT to be included:
 *
 * each
 * map
 * filter
 * reduce
 * eq
 * spread
 * cloneDeep - This is actually slower than JSON.parse(JSON.stringify(obj)).
 * includes
 * isArray
 */