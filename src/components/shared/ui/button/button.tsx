import React from 'react';
import PropTypes from 'prop-types';

const SvgIcon = ({ name, width, height, viewBox, className, children, ...props }) => {
  // Default SVG attributes that are commonly used and can be overridden by props
  const defaultSvgProps = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: width || '1em',
    height: height || '1em',
    viewBox: viewBox || '0 0 24 24',
    className: `svg-icon svg-icon-${name} ${className || ''}`.trim(),
    ...props,
  };

  // Handle potential SVG attribute name mismatches (e.g., fill-rule vs fillRule)
  // This is a basic example; a more robust solution might involve a mapping
  const sanitizedProps = Object.keys(defaultSvgProps).reduce((acc, key) => {
    let sanitizedKey = key;
    if (key === 'fill-rule') sanitizedKey = 'fillRule';
    if (key === 'stroke-width') sanitizedKey = 'strokeWidth';
    if (key === 'stroke-linecap') sanitizedKey = 'strokeLinecap';
    if (key === 'stroke-linejoin') sanitizedKey = 'strokeLinejoin';
    // Add more mappings as needed for other SVG attributes
    acc[sanitizedKey] = defaultSvgProps[key];
    return acc;
  }, {});


  return (
    <svg {...sanitizedProps}>
      {children}
    </svg>
  );
};

SvgIcon.propTypes = {
  name: PropTypes.string.isRequired,
  width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  height: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  viewBox: PropTypes.string,
  className: PropTypes.string,
  children: PropTypes.node,
};

export default SvgIcon;