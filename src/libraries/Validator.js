'use strict';

const vm = require('vm');
const _ = require('lodash');

const { JoiX, checkConditional } = require('./JoiX');
const util = require('../libraries/Util');
const moment = require('moment');

/**
 * @TODO: Add description.
 *
 * @param form
 * @param model
 * @constructor
 */
class Validator {
  constructor(form, model, token) {
    this.model = model;
    this.async = [];
    this.requests = {};
    this.form = form;
    this.token = token;
  }

  /**
   * Returns a validator per component.
   *
   * @param {Object} schema
   *   The validation schema to modify.
   * @param {Object} component
   *   The form component.
   * @param {Object} componentData
   *   The submission data corresponding to this component.
   */
  buildSchema(schema, components, componentData, submission) {
    if (!Array.isArray(components)) {
      return schema;
    }
    // Add a validator for each component in the form, with its componentData.
    /* eslint-disable max-statements */
    components.forEach((component) => {
      let fieldValidator = null;

      this.applyLogic(component, componentData, submission.data);
      this.calculateValue(component, componentData, submission.data);

      // The value is persistent if it doesn't say otherwise or explicitly says so.
      const isPersistent = !component.hasOwnProperty('persistent') || component.persistent;

      let objectSchema;
      const stringValidators = {
        minLength: 'min',
        maxLength: 'max',
        minWords: 'minWords',
        maxWords: 'maxWords'
      };
      /* eslint-disable max-depth, valid-typeof */
      switch (component.type) {
        case 'form': {
          // Ensure each sub submission at least has an empty object or it won't validate.
          _.update(componentData, `${component.key}.data`, value => value ? value : {});

          const subSubmission = _.get(componentData, component.key, {});

          // If this has already been submitted, then it has been validated.
          if (!subSubmission._id && component.components) {
            const formSchema = this.buildSchema(
              {},
              component.components,
              subSubmission,
              subSubmission
            );
            fieldValidator = JoiX.object().unknown(true).keys({
              data: JoiX.object().keys(formSchema)
            });
          }
          else {
            fieldValidator = JoiX.object();
          }
          break;
        }
        case 'editgrid':
        case 'datagrid':
          component.multiple = false;
          objectSchema = this.buildSchema(
            {},
            component.components,
            _.get(componentData, component.key, componentData),
            submission
          );

          fieldValidator = JoiX.array().items(JoiX.object().keys(objectSchema)).options({stripUnknown: false});
          break;
        case 'container':
          objectSchema = this.buildSchema(
            {},
            component.components,
            _.get(componentData, component.key, componentData),
            submission
          );

          fieldValidator = JoiX.object().keys(objectSchema);
          break;
        case 'fieldset':
        case 'panel':
        case 'well':
          this.buildSchema(schema, component.components, componentData, submission);
          break;
        case 'table':
          if (!Array.isArray(component.rows)) {
            break;
          }
          component.rows.forEach((row) => {
            if (!Array.isArray(row)) {
              return;
            }
            row.forEach((column) => {
              this.buildSchema(schema, column.components, componentData, submission);
            });
          });
          break;
        case 'columns':
          if (!Array.isArray(component.columns)) {
            break;
          }
          component.columns.forEach((column) => {
            this.buildSchema(schema, column.components, componentData, submission);
          });
          break;
        case 'textfield':
        case 'textarea':
        case 'phonenumber':
          if (component.as === 'json') {
            fieldValidator = JoiX.object();
          }
          else {
            fieldValidator = JoiX.string().allow('');
            for (const name in stringValidators) {
              const funcName = stringValidators[name];
              if (
                component.validate &&
                component.validate.hasOwnProperty(name) &&
                _.isNumber(component.validate[name]) &&
                component.validate[name] >= 0
              ) {
                fieldValidator = fieldValidator[funcName](component.validate[name]);
              }
            }
          }
          break;
        case 'select':
          if (component.validate && component.validate.select) {
            fieldValidator = JoiX.any().select(component, submission, this.token, this.async, this.requests);
          }
          fieldValidator = fieldValidator || JoiX.any();
          break;
        case 'email':
          fieldValidator = JoiX.string().email().allow('');
          break;
        case 'number':
          fieldValidator = JoiX.number().empty(null);
          if (component.validate) {
            // If the step is provided... we can infer float vs. integer.
            if (component.validate.step && (component.validate.step !== 'any')) {
              const parts = component.validate.step.split('.');
              if (parts.length === 1) {
                fieldValidator = fieldValidator.integer();
              }
              else {
                fieldValidator = fieldValidator.precision(parts[1].length);
              }
            }

            _.each(['min', 'max', 'greater', 'less'], (check) => {
              if (component.validate.hasOwnProperty(check) && _.isNumber(component.validate[check])) {
                fieldValidator = fieldValidator[check](component.validate[check]);
              }
            });
          }
          break;
        case 'signature':
          fieldValidator = JoiX.string().allow('');
          break;
        case 'checkbox':
          if (component.name && !_.find(components, ['key', component.name])) {
            schema[component.name] = JoiX.any();
          }
          fieldValidator = fieldValidator || JoiX.any();
          break;
        default:
          // Allow custom components to have subcomponents as well (like layout components).
          if (component.components && Array.isArray(component.components)) {
            if (component.tree) {
              objectSchema = this.buildSchema(
                {},
                component.components,
                _.get(componentData, component.key, componentData),
                submission
              );
              fieldValidator = JoiX.object().keys(objectSchema);
            }
            else {
              this.buildSchema(
                schema,
                component.components,
                componentData,
                submission
              );
            }
          }
          fieldValidator = fieldValidator || JoiX.any();
          break;
      }
      /* eslint-enable max-depth, valid-typeof */

      if (component.key && (component.key.indexOf('.') === -1) && component.validate) {
        // Add required validator.
        if (component.validate.required) {
          fieldValidator = fieldValidator.required().empty().disallow('', null);
        }

        // Add regex validator
        if (component.validate.pattern) {
          try {
            const regex = new RegExp(component.validate.pattern);
            fieldValidator = fieldValidator.regex(regex);
          }
          catch (err) {
            console.error(err);
          }
        }

        // Add the custom validations.
        if (component.validate && component.validate.custom) {
          fieldValidator = fieldValidator.custom(component, submission.data);
        }

        // Add the json logic validations.
        if (component.validate && component.validate.json) {
          fieldValidator = fieldValidator.json(component, submission.data);
        }
      }

      // If the value must be unique.
      if (component.unique) {
        fieldValidator = fieldValidator.distinct(component, submission, this.model, this.async);
      }

      //if multiple masks input, then data is object with 'value' field, and validation should be applied to that field
      if (component.allowMultipleMasks) {
        fieldValidator = JoiX.object().keys({
          value: fieldValidator,
          maskName: JoiX.string()
        });
        //additionally apply required rule to the field itself
        if (component.validate && component.validate.required) {
          fieldValidator = fieldValidator.required();
        }
      }

      // Make sure to change this to an array if multiple is checked.
      if (component.multiple) {
        // Allow(null) was added since some text fields have empty strings converted to null when multiple which then
        // throws an error on re-validation. Allowing null fixes the issue.
        fieldValidator = JoiX.array().sparse().items(fieldValidator.allow(null)).options({stripUnknown: false});
        // If a multi-value is required, make sure there is at least one.
        if (component.validate && component.validate.required) {
          fieldValidator = fieldValidator.min(1).required();
        }
      }

      // Only run validations for persistent fields.
      if (component.key && fieldValidator && isPersistent) {
        schema[component.key] = fieldValidator.hidden(component, submission.data);
      }
    });
    /* eslint-enable max-statements */

    return schema;
  }

  applyLogic(component, row, data) {
    if (!Array.isArray(component.logic)) {
      return;
    }

    component.logic.forEach(logic => {
      const result = util.checkTrigger(component, logic.trigger, row, data);

      if (result) {
        if (!Array.isArray(logic.actions)) {
          return;
        }
        logic.actions.forEach(action => {
          switch (action.type) {
            case 'property':
              util.setActionProperty(component, action, row, data, component, result);
              break;
            case 'value':
              try {
                // Create the sandbox.
                const sandbox = vm.createContext({
                  value: _.get(row, component.key),
                  data,
                  row,
                  component,
                  result
                });

                // Execute the script.
                const script = new vm.Script(action.value);
                script.runInContext(sandbox, {
                  timeout: 250
                });

                _.set(row, component.key, sandbox.value.toString());
              }
              catch (e) {
                console.error(e);
              }
              break;
          }
        });
      }
    });
  }

  calculateValue(component, row, data) {
    if (component.calculateServer && component.calculateValue) {
      if (_.isString(component.calculateValue)) {
        try {
          const sandbox = vm.createContext({
            value: _.get(row, component.key),
            data,
            row,
            component,
            util,
            moment
          });

          // Execute the script.
          const script = new vm.Script(component.calculateValue);
          script.runInContext(sandbox, {
            timeout: 250
          });

          _.set(row, component.key, sandbox.value);
        }
        catch (e) {
          // Need to log error for calculated value.
        }
      }
      else {
        try {
          _.set(row, component.key, util.jsonLogic(component.calculateValue, {
            data,
            row,
            _
          }));
        }
        catch (e) {
          // Need to log error for calculated value.
        }
      }
    }
  }

  /**
   * Validate a submission for a form.
   *
   * @param {Object} submission
   *   The data submission object.
   * @param next
   *   The callback function to pass the results.
   */
  /* eslint-disable max-statements */
  validate(submission, next) {
    // Skip validation if no data is provided.
    if (!submission.data) {
      return next();
    }

    // Build the JoiX validation schema.
    let schema = {
      // Start off with the _id key.
      _id: JoiX.string().meta({primaryKey: true})
    };

    // Create the validator schema.
    schema = JoiX.object().keys(this.buildSchema(schema, this.form.components, submission.data, submission));

    // Iterate the list of components one time to build the path map.
    const components = {};
    util.eachComponent(this.form.components, (component, path) => {
      if (component.hasOwnProperty('key')) {
        components[path] = component;
      }
    }, true, '', true);

    JoiX.validate(submission.data, schema, {stripUnknown: true, abortEarly: false}, (validateErr, value) => {
      // Wait for all async validators to complete and add any errors.
      Promise.all(this.async).then(errors => {
        errors = errors.filter(item => item);
        // Add in any asyncronous errors.
        if (errors.length) {
          if (!validateErr) {
            validateErr = new Error('Validation failed');
            validateErr.name = 'ValidationError';
            validateErr.details = errors;
          }
          else {
            validateErr.details = validateErr.details.concat(errors);
          }
        }
        if (validateErr) {
          // Remove any conditionally hidden validations. Joi will still throw the errors but we don't want them since the
          // fields are hidden.
          validateErr.details = validateErr.details.filter((detail) => {
            let result = {
              hidden: false
            };
            if (detail.type.includes('.hidden')) {
              const component = components[detail.path.filter(isNaN).join('.')];

              const clearOnHide = util.isBoolean(_.get(component, 'clearOnHide')) ?
                util.boolean(_.get(component, 'clearOnHide')) : true;

              if (clearOnHide) {
                _.unset(value, detail.path);
              }

              result.hidden = true;
            }
            else {
              // Walk up the path tree to determine if the component is hidden.
              result = detail.path.reduce((result, key) => {
                result.path.push(key);

                const component = components[result.path.filter(isNaN).join('.')];

                // Form "data" keys don't have components.
                if (component) {
                  result.hidden = result.hidden ||
                    !checkConditional(component,
                      _.get(value, result.path.slice(0, result.path.length - 1)), result.submission, true);

                  const clearOnHide = util.isBoolean(_.get(component, 'clearOnHide')) ?
                    util.boolean(_.get(component, 'clearOnHide')) : true;

                  if (clearOnHide && result.hidden) {
                    _.unset(value, result.path);
                  }
                }
                else {
                  // Since this is a subform, change the submission object going to the conditionals.
                  result.submission = _.get(value, result.path);
                }

                return result;
              }, {path: [], hidden: false, submission: value});
            }

            return !result.hidden;
          });

          // Only throw error if there are still errors.
          if (validateErr.details.length) {
            validateErr._validated = value;

            return next(validateErr);
          }
          else {
            validateErr._object = value;
          }
        }

        submission.data = value;
        next(null, value);
      });
    });
  }
  /* eslint-enable max-statements */
}

module.exports = Validator;
